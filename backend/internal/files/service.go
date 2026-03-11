package files

import (
	"archive/zip"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/session"
	sshsvc "term-webclient-go/backend/internal/ssh"
	"term-webclient-go/backend/internal/util"
)

type Service struct {
	cfg      *config.Config
	sessions *session.Service
	ssh      *sshsvc.Manager
	tickets  *downloadTicketStore
}

type DownloadHandle struct {
	FileName string
	Size     int64
	Reader   io.ReadCloser
	Close    func() error
}

type ArchiveEntry struct {
	ArchivePath string
	Size        int64
	Open        func() (io.ReadCloser, error)
}

type managedReadCloser struct {
	reader  io.ReadCloser
	closeFn func() error
}

func (r *managedReadCloser) Read(p []byte) (int, error) {
	return r.reader.Read(p)
}

func (r *managedReadCloser) Close() error {
	err := r.reader.Close()
	if r.closeFn != nil {
		if closeErr := r.closeFn(); err == nil {
			err = closeErr
		}
	}
	return err
}

type DownloadTicketPayload struct {
	Mode        string
	SessionID   string
	Path        string
	Paths       []string
	ArchiveName string
	ExpiresAt   time.Time
}

type downloadTicketStore struct {
	mu      sync.Mutex
	payload map[string]DownloadTicketPayload
}

func New(cfg *config.Config, sessions *session.Service, ssh *sshsvc.Manager) *Service {
	return &Service{
		cfg:      cfg,
		sessions: sessions,
		ssh:      ssh,
		tickets: &downloadTicketStore{
			payload: map[string]DownloadTicketPayload{},
		},
	}
}

func (s *Service) Tree(sessionID, targetPath string) (model.FileTreeResponse, error) {
	gateway, err := s.resolveGateway(sessionID)
	if err != nil {
		return model.FileTreeResponse{}, err
	}
	return gateway.Tree(targetPath)
}

func (s *Service) Mkdir(sessionID, parentPath, name string) (model.FileMkdirResponse, error) {
	gateway, err := s.resolveGateway(sessionID)
	if err != nil {
		return model.FileMkdirResponse{}, err
	}
	return gateway.Mkdir(parentPath, name)
}

func (s *Service) Upload(sessionID, targetPath string, policy model.UploadConflictPolicy, files []*multipart.FileHeader) (model.FileUploadResponse, error) {
	if err := s.ensureEnabled(); err != nil {
		return model.FileUploadResponse{}, err
	}
	if len(files) == 0 {
		return model.FileUploadResponse{}, util.NewStatusError(http.StatusBadRequest, "files must not be empty", nil)
	}
	var declaredSize int64
	for _, file := range files {
		if file != nil {
			declaredSize += file.Size
		}
	}
	if declaredSize > s.cfg.Terminal.Files.MaxUploadRequestBytes {
		return model.FileUploadResponse{}, util.NewStatusError(http.StatusRequestEntityTooLarge, "upload request exceeds maxUploadRequestBytes", nil)
	}

	gateway, err := s.resolveGateway(sessionID)
	if err != nil {
		return model.FileUploadResponse{}, err
	}

	results := make([]model.FileUploadItemResponse, 0, len(files))
	for _, header := range files {
		fileName := ""
		fileSize := int64(0)
		if header != nil {
			fileName = header.Filename
			fileSize = header.Size
		}
		if header == nil || fileName == "" {
			errText := "file is empty"
			results = append(results, model.FileUploadItemResponse{
				FileName: fileName,
				Status:   "FAILED",
				Size:     fileSize,
				Error:    &errText,
			})
			continue
		}
		if fileSize > s.cfg.Terminal.Files.MaxUploadFileBytes {
			errText := "file exceeds maxUploadFileBytes"
			results = append(results, model.FileUploadItemResponse{
				FileName: fileName,
				Status:   "FAILED",
				Size:     fileSize,
				Error:    &errText,
			})
			continue
		}
		reader, err := header.Open()
		if err != nil {
			errText := err.Error()
			results = append(results, model.FileUploadItemResponse{
				FileName: fileName,
				Status:   "FAILED",
				Size:     fileSize,
				Error:    &errText,
			})
			continue
		}
		response, err := gateway.Upload(targetPath, fileName, reader, fileSize, policy)
		_ = reader.Close()
		if err != nil {
			errText := err.Error()
			results = append(results, model.FileUploadItemResponse{
				FileName: fileName,
				Status:   "FAILED",
				Size:     fileSize,
				Error:    &errText,
			})
			continue
		}
		results = append(results, response)
	}

	return model.FileUploadResponse{Results: results}, nil
}

func (s *Service) OpenDownload(sessionID, requestPath string) (*DownloadHandle, error) {
	gateway, err := s.resolveGateway(sessionID)
	if err != nil {
		return nil, err
	}
	return gateway.OpenDownload(requestPath)
}

func (s *Service) ArchiveEntries(sessionID string, paths []string) ([]ArchiveEntry, int64, error) {
	gateway, err := s.resolveGateway(sessionID)
	if err != nil {
		return nil, 0, err
	}
	entries, totalBytes, err := gateway.ArchiveEntries(paths)
	if err != nil {
		return nil, 0, err
	}
	if totalBytes > s.cfg.Terminal.Files.MaxDownloadArchiveBytes {
		return nil, 0, util.NewStatusError(http.StatusRequestEntityTooLarge, "archive exceeds maxDownloadArchiveBytes", nil)
	}
	return entries, totalBytes, nil
}

func (s *Service) CreateDownloadTicket(sessionID string, request model.FileDownloadTicketRequest, apiPrefix string) (model.FileDownloadTicketResponse, error) {
	if err := s.ensureEnabled(); err != nil {
		return model.FileDownloadTicketResponse{}, err
	}
	mode := strings.TrimSpace(request.Mode)
	if mode == "" {
		return model.FileDownloadTicketResponse{}, util.NewStatusError(http.StatusBadRequest, "mode is required", nil)
	}
	switch mode {
	case "single":
		if strings.TrimSpace(request.Path) == "" {
			return model.FileDownloadTicketResponse{}, util.NewStatusError(http.StatusBadRequest, "path is required for single mode", nil)
		}
	case "archive":
		if len(request.Paths) == 0 {
			return model.FileDownloadTicketResponse{}, util.NewStatusError(http.StatusBadRequest, "paths are required for archive mode", nil)
		}
	default:
		return model.FileDownloadTicketResponse{}, util.NewStatusError(http.StatusBadRequest, "unsupported download ticket mode", nil)
	}

	ticket := util.NewID()
	expiresAt := time.Now().UTC().Add(time.Duration(s.cfg.Terminal.Files.DownloadTicketTTLSeconds) * time.Second)
	s.tickets.mu.Lock()
	s.tickets.payload[ticket] = DownloadTicketPayload{
		Mode:        mode,
		SessionID:   sessionID,
		Path:        request.Path,
		Paths:       append([]string(nil), request.Paths...),
		ArchiveName: request.ArchiveName,
		ExpiresAt:   expiresAt,
	}
	s.tickets.mu.Unlock()

	downloadURL := ""
	if mode == "single" {
		downloadURL = strings.TrimRight(apiPrefix, "/") + "/sessions/" + sessionID + "/files/download?ticket=" + ticket
	} else {
		downloadURL = strings.TrimRight(apiPrefix, "/") + "/sessions/" + sessionID + "/files/download-archive?ticket=" + ticket
	}
	return model.FileDownloadTicketResponse{
		Ticket:      ticket,
		DownloadURL: downloadURL,
		ExpiresAt:   expiresAt,
	}, nil
}

func (s *Service) ConsumeDownloadTicket(ticket, sessionID, mode string) (DownloadTicketPayload, error) {
	s.tickets.mu.Lock()
	defer s.tickets.mu.Unlock()
	payload, ok := s.tickets.payload[ticket]
	if !ok {
		return DownloadTicketPayload{}, util.NewStatusError(http.StatusNotFound, "download ticket not found", nil)
	}
	delete(s.tickets.payload, ticket)
	if time.Now().UTC().After(payload.ExpiresAt) {
		return DownloadTicketPayload{}, util.NewStatusError(http.StatusNotFound, "download ticket expired", nil)
	}
	if payload.SessionID != sessionID || payload.Mode != mode {
		return DownloadTicketPayload{}, util.NewStatusError(http.StatusNotFound, "download ticket not found", nil)
	}
	return payload, nil
}

func StreamArchive(writer io.Writer, entries []ArchiveEntry) error {
	zipWriter := zip.NewWriter(writer)
	for _, entry := range entries {
		header := &zip.FileHeader{
			Name:   entry.ArchivePath,
			Method: zip.Deflate,
		}
		zipEntryWriter, err := zipWriter.CreateHeader(header)
		if err != nil {
			_ = zipWriter.Close()
			return err
		}
		reader, err := entry.Open()
		if err != nil {
			_ = zipWriter.Close()
			return err
		}
		if _, err := io.Copy(zipEntryWriter, reader); err != nil {
			_ = reader.Close()
			_ = zipWriter.Close()
			return err
		}
		_ = reader.Close()
	}
	return zipWriter.Close()
}

func (s *Service) resolveGateway(sessionID string) (fileGateway, error) {
	if err := s.ensureEnabled(); err != nil {
		return nil, err
	}
	sessionValue, err := s.sessions.GetRequiredSession(sessionID)
	if err != nil {
		return nil, err
	}
	if sessionValue.SessionType == model.SessionTypeSSHShell {
		if strings.TrimSpace(sessionValue.SSHCredentialID) == "" {
			return nil, util.NewStatusError(http.StatusBadRequest, "session is missing ssh file binding", nil)
		}
		return &sftpGateway{
			rootPath:     sessionValue.FileRootPath,
			credentialID: sessionValue.SSHCredentialID,
			ssh:          s.ssh,
			cfg:          s.cfg,
		}, nil
	}
	return &localGateway{
		rootPath: sessionValue.FileRootPath,
		cfg:      s.cfg,
	}, nil
}

func (s *Service) ensureEnabled() error {
	if !s.cfg.Terminal.Files.Enabled {
		return util.NewStatusError(http.StatusForbidden, "file transfer is disabled", nil)
	}
	return nil
}

type fileGateway interface {
	Tree(targetPath string) (model.FileTreeResponse, error)
	Mkdir(parentPath, name string) (model.FileMkdirResponse, error)
	Upload(targetPath, fileName string, reader io.Reader, size int64, policy model.UploadConflictPolicy) (model.FileUploadItemResponse, error)
	OpenDownload(path string) (*DownloadHandle, error)
	ArchiveEntries(paths []string) ([]ArchiveEntry, int64, error)
}

type localGateway struct {
	rootPath string
	cfg      *config.Config
}

func (g *localGateway) Tree(targetPath string) (model.FileTreeResponse, error) {
	resolvedPath, err := g.resolvePath(targetPath, true)
	if err != nil {
		return model.FileTreeResponse{}, err
	}
	dirEntries, err := os.ReadDir(resolvedPath)
	if err != nil {
		return model.FileTreeResponse{}, util.NewStatusError(http.StatusBadRequest, "failed to read directory", err)
	}
	entries := make([]model.FileTreeEntryResponse, 0, len(dirEntries))
	for _, entry := range dirEntries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		entryType := model.FileEntryTypeFile
		if info.IsDir() {
			entryType = model.FileEntryTypeDirectory
		}
		entries = append(entries, model.FileTreeEntryResponse{
			Name:     entry.Name(),
			Path:     filepath.Join(resolvedPath, entry.Name()),
			Type:     entryType,
			Size:     info.Size(),
			Mtime:    info.ModTime().UnixMilli(),
			Readable: true,
			Writable: true,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Type != entries[j].Type {
			return entries[i].Type == model.FileEntryTypeDirectory
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	parentPath := filepath.Dir(resolvedPath)
	var parentPtr *string
	if filepath.Clean(resolvedPath) != filepath.Clean(g.rootPath) {
		parentPtr = &parentPath
	}
	return model.FileTreeResponse{
		CurrentPath: resolvedPath,
		ParentPath:  parentPtr,
		Entries:     entries,
	}, nil
}

func (g *localGateway) Mkdir(parentPath, name string) (model.FileMkdirResponse, error) {
	parent, err := g.resolvePath(parentPath, true)
	if err != nil {
		return model.FileMkdirResponse{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return model.FileMkdirResponse{}, util.NewStatusError(http.StatusBadRequest, "name must not be blank", nil)
	}
	createdPath := filepath.Join(parent, name)
	if err := os.MkdirAll(createdPath, 0o755); err != nil {
		return model.FileMkdirResponse{}, util.NewStatusError(http.StatusBadRequest, "failed to create directory", err)
	}
	return model.FileMkdirResponse{CreatedPath: createdPath, Created: true}, nil
}

func (g *localGateway) Upload(targetPath, fileName string, reader io.Reader, size int64, policy model.UploadConflictPolicy) (model.FileUploadItemResponse, error) {
	targetDir, err := g.resolvePath(targetPath, true)
	if err != nil {
		return model.FileUploadItemResponse{}, err
	}
	resolvedPath, err := resolveLocalConflictPath(targetDir, fileName, policy)
	if err != nil {
		return model.FileUploadItemResponse{}, err
	}
	targetFile, err := os.Create(resolvedPath)
	if err != nil {
		return model.FileUploadItemResponse{}, util.NewStatusError(http.StatusBadRequest, "failed to save file", err)
	}
	defer targetFile.Close()
	if _, err := io.Copy(targetFile, reader); err != nil {
		return model.FileUploadItemResponse{}, util.NewStatusError(http.StatusBadRequest, "failed to save file", err)
	}
	savedPath := resolvedPath
	return model.FileUploadItemResponse{
		FileName:  fileName,
		Status:    "SUCCESS",
		SavedPath: &savedPath,
		Size:      size,
	}, nil
}

func (g *localGateway) OpenDownload(requestPath string) (*DownloadHandle, error) {
	resolvedPath, err := g.resolvePath(requestPath, false)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(resolvedPath)
	if err != nil {
		return nil, util.NewStatusError(http.StatusBadRequest, "failed to open file", err)
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, util.NewStatusError(http.StatusBadRequest, "failed to stat file", err)
	}
	return &DownloadHandle{
		FileName: filepath.Base(resolvedPath),
		Size:     info.Size(),
		Reader:   file,
		Close:    file.Close,
	}, nil
}

func (g *localGateway) ArchiveEntries(paths []string) ([]ArchiveEntry, int64, error) {
	entries := make([]ArchiveEntry, 0)
	var totalBytes int64
	for _, rawPath := range paths {
		resolvedPath, err := g.resolvePath(rawPath, false)
		if err != nil {
			return nil, 0, err
		}
		baseName := filepath.Base(resolvedPath)
		err = filepath.Walk(resolvedPath, func(currentPath string, info os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if info.IsDir() {
				return nil
			}
			relativePath, err := filepath.Rel(filepath.Dir(resolvedPath), currentPath)
			if err != nil {
				return err
			}
			archivePath := filepath.ToSlash(relativePath)
			if baseName == archivePath {
				archivePath = filepath.Base(currentPath)
			}
			filePath := currentPath
			size := info.Size()
			entries = append(entries, ArchiveEntry{
				ArchivePath: archivePath,
				Size:        size,
				Open: func() (io.ReadCloser, error) {
					return os.Open(filePath)
				},
			})
			totalBytes += size
			return nil
		})
		if err != nil {
			return nil, 0, util.NewStatusError(http.StatusBadRequest, "failed to plan archive", err)
		}
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].ArchivePath < entries[j].ArchivePath
	})
	return entries, totalBytes, nil
}

func (g *localGateway) resolvePath(input string, directory bool) (string, error) {
	targetPath := strings.TrimSpace(input)
	if targetPath == "" {
		targetPath = g.rootPath
	}
	if !filepath.IsAbs(targetPath) {
		targetPath = filepath.Join(g.rootPath, targetPath)
	}
	targetPath = filepath.Clean(targetPath)
	if !g.cfg.Terminal.Files.AllowOutsideRoot && !isWithinLocalRoot(g.rootPath, targetPath) {
		return "", util.NewStatusError(http.StatusForbidden, "path must stay inside file root", nil)
	}
	info, err := os.Stat(targetPath)
	if err != nil {
		return "", util.NewStatusError(http.StatusBadRequest, "path does not exist", err)
	}
	if directory && !info.IsDir() {
		return "", util.NewStatusError(http.StatusBadRequest, "path must be an existing directory", nil)
	}
	if !directory && info.IsDir() {
		return "", util.NewStatusError(http.StatusBadRequest, "path must be a file", nil)
	}
	return targetPath, nil
}

type sftpGateway struct {
	rootPath     string
	credentialID string
	ssh          *sshsvc.Manager
	cfg          *config.Config
}

func (g *sftpGateway) Tree(targetPath string) (model.FileTreeResponse, error) {
	client, closeFn, err := g.ssh.OpenSFTP(g.credentialID)
	if err != nil {
		return model.FileTreeResponse{}, err
	}
	defer closeFn()

	resolvedPath, err := g.resolvePath(targetPath, true)
	if err != nil {
		return model.FileTreeResponse{}, err
	}
	entriesInfo, err := client.ReadDir(resolvedPath)
	if err != nil {
		return model.FileTreeResponse{}, util.NewStatusError(http.StatusBadRequest, "failed to read directory", err)
	}
	entries := make([]model.FileTreeEntryResponse, 0, len(entriesInfo))
	for _, info := range entriesInfo {
		entryType := model.FileEntryTypeFile
		if info.IsDir() {
			entryType = model.FileEntryTypeDirectory
		}
		entries = append(entries, model.FileTreeEntryResponse{
			Name:     info.Name(),
			Path:     path.Join(resolvedPath, info.Name()),
			Type:     entryType,
			Size:     info.Size(),
			Mtime:    info.ModTime().UnixMilli(),
			Readable: true,
			Writable: true,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Type != entries[j].Type {
			return entries[i].Type == model.FileEntryTypeDirectory
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	var parentPtr *string
	if cleanRemotePath(resolvedPath) != cleanRemotePath(g.rootPath) {
		parentPath := path.Dir(resolvedPath)
		parentPtr = &parentPath
	}
	return model.FileTreeResponse{
		CurrentPath: resolvedPath,
		ParentPath:  parentPtr,
		Entries:     entries,
	}, nil
}

func (g *sftpGateway) Mkdir(parentPath, name string) (model.FileMkdirResponse, error) {
	client, closeFn, err := g.ssh.OpenSFTP(g.credentialID)
	if err != nil {
		return model.FileMkdirResponse{}, err
	}
	defer closeFn()
	parent, err := g.resolvePath(parentPath, true)
	if err != nil {
		return model.FileMkdirResponse{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return model.FileMkdirResponse{}, util.NewStatusError(http.StatusBadRequest, "name must not be blank", nil)
	}
	createdPath := path.Join(parent, name)
	if err := client.MkdirAll(createdPath); err != nil {
		return model.FileMkdirResponse{}, util.NewStatusError(http.StatusBadRequest, "failed to create directory", err)
	}
	return model.FileMkdirResponse{CreatedPath: createdPath, Created: true}, nil
}

func (g *sftpGateway) Upload(targetPath, fileName string, reader io.Reader, size int64, policy model.UploadConflictPolicy) (model.FileUploadItemResponse, error) {
	client, closeFn, err := g.ssh.OpenSFTP(g.credentialID)
	if err != nil {
		return model.FileUploadItemResponse{}, err
	}
	defer closeFn()
	targetDir, err := g.resolvePath(targetPath, true)
	if err != nil {
		return model.FileUploadItemResponse{}, err
	}
	resolvedPath, err := resolveRemoteConflictPath(client, targetDir, fileName, policy)
	if err != nil {
		return model.FileUploadItemResponse{}, err
	}
	file, err := client.OpenFile(resolvedPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC)
	if err != nil {
		return model.FileUploadItemResponse{}, util.NewStatusError(http.StatusBadRequest, "failed to save file", err)
	}
	defer file.Close()
	if _, err := io.Copy(file, reader); err != nil {
		return model.FileUploadItemResponse{}, util.NewStatusError(http.StatusBadRequest, "failed to save file", err)
	}
	savedPath := resolvedPath
	return model.FileUploadItemResponse{
		FileName:  fileName,
		Status:    "SUCCESS",
		SavedPath: &savedPath,
		Size:      size,
	}, nil
}

func (g *sftpGateway) OpenDownload(requestPath string) (*DownloadHandle, error) {
	client, closeFn, err := g.ssh.OpenSFTP(g.credentialID)
	if err != nil {
		return nil, err
	}
	resolvedPath, err := g.resolvePath(requestPath, false)
	if err != nil {
		closeFn()
		return nil, err
	}
	file, err := client.Open(resolvedPath)
	if err != nil {
		closeFn()
		return nil, util.NewStatusError(http.StatusBadRequest, "failed to open file", err)
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		closeFn()
		return nil, util.NewStatusError(http.StatusBadRequest, "failed to stat file", err)
	}
	return &DownloadHandle{
		FileName: path.Base(resolvedPath),
		Size:     info.Size(),
		Reader:   file,
		Close: func() error {
			_ = file.Close()
			return closeFn()
		},
	}, nil
}

func (g *sftpGateway) ArchiveEntries(paths []string) ([]ArchiveEntry, int64, error) {
	client, closeFn, err := g.ssh.OpenSFTP(g.credentialID)
	if err != nil {
		return nil, 0, err
	}
	defer closeFn()

	entries := make([]ArchiveEntry, 0)
	var totalBytes int64
	for _, rawPath := range paths {
		resolvedPath, err := g.resolvePath(rawPath, false)
		if err != nil {
			if strings.Contains(err.Error(), "path must be a file") {
				resolvedPath, err = g.resolvePath(rawPath, true)
				if err != nil {
					return nil, 0, err
				}
				err = g.walkRemote(client, resolvedPath, path.Dir(resolvedPath), &entries, &totalBytes)
				if err != nil {
					return nil, 0, err
				}
				continue
			}
			return nil, 0, err
		}
		info, err := client.Stat(resolvedPath)
		if err != nil {
			return nil, 0, util.NewStatusError(http.StatusBadRequest, "failed to stat file", err)
		}
		filePath := resolvedPath
		size := info.Size()
		archivePath := path.Base(filePath)
		entries = append(entries, ArchiveEntry{
			ArchivePath: archivePath,
			Size:        size,
			Open: func() (io.ReadCloser, error) {
				return g.openArchiveFile(filePath)
			},
		})
		totalBytes += size
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].ArchivePath < entries[j].ArchivePath
	})
	return entries, totalBytes, nil
}

func (g *sftpGateway) walkRemote(client *sftp.Client, targetPath, basePath string, entries *[]ArchiveEntry, totalBytes *int64) error {
	dirEntries, err := client.ReadDir(targetPath)
	if err != nil {
		return util.NewStatusError(http.StatusBadRequest, "failed to plan archive", err)
	}
	for _, info := range dirEntries {
		childPath := path.Join(targetPath, info.Name())
		if info.IsDir() {
			if err := g.walkRemote(client, childPath, basePath, entries, totalBytes); err != nil {
				return err
			}
			continue
		}
		filePath := childPath
		size := info.Size()
		archivePath := strings.TrimPrefix(strings.TrimPrefix(filePath, basePath), "/")
		*entries = append(*entries, ArchiveEntry{
			ArchivePath: archivePath,
			Size:        size,
			Open: func() (io.ReadCloser, error) {
				return g.openArchiveFile(filePath)
			},
		})
		*totalBytes += size
	}
	return nil
}

func (g *sftpGateway) openArchiveFile(filePath string) (io.ReadCloser, error) {
	client, closeFn, err := g.ssh.OpenSFTP(g.credentialID)
	if err != nil {
		return nil, err
	}
	file, err := client.Open(filePath)
	if err != nil {
		_ = closeFn()
		return nil, util.NewStatusError(http.StatusBadRequest, "failed to open file", err)
	}
	return &managedReadCloser{
		reader:  file,
		closeFn: closeFn,
	}, nil
}

func (g *sftpGateway) resolvePath(input string, directory bool) (string, error) {
	targetPath := strings.TrimSpace(input)
	if targetPath == "" {
		targetPath = g.rootPath
	}
	if !strings.HasPrefix(targetPath, "/") {
		targetPath = path.Join(g.rootPath, targetPath)
	}
	targetPath = cleanRemotePath(targetPath)
	if !g.cfg.Terminal.Files.AllowOutsideRoot && !isWithinRemoteRoot(g.rootPath, targetPath) {
		return "", util.NewStatusError(http.StatusForbidden, "path must stay inside file root", nil)
	}
	client, closeFn, err := g.ssh.OpenSFTP(g.credentialID)
	if err != nil {
		return "", err
	}
	defer closeFn()
	info, err := client.Stat(targetPath)
	if err != nil {
		return "", util.NewStatusError(http.StatusBadRequest, "path does not exist", err)
	}
	if directory && !info.IsDir() {
		return "", util.NewStatusError(http.StatusBadRequest, "path must be an existing directory", nil)
	}
	if !directory && info.IsDir() {
		return "", util.NewStatusError(http.StatusBadRequest, "path must be a file", nil)
	}
	return targetPath, nil
}

func resolveLocalConflictPath(targetDir, fileName string, policy model.UploadConflictPolicy) (string, error) {
	return resolveConflictPath(
		targetDir,
		fileName,
		policy,
		func(candidate string) (bool, error) {
			_, err := os.Stat(candidate)
			return err == nil, nil
		},
		filepath.Join,
		filepath.Ext,
	)
}

func resolveRemoteConflictPath(client *sftp.Client, targetDir, fileName string, policy model.UploadConflictPolicy) (string, error) {
	return resolveConflictPath(
		targetDir,
		fileName,
		policy,
		func(candidate string) (bool, error) {
			_, err := client.Stat(candidate)
			return err == nil, nil
		},
		path.Join,
		path.Ext,
	)
}

func resolveConflictPath(
	targetDir,
	fileName string,
	policy model.UploadConflictPolicy,
	existsFn func(string) (bool, error),
	joinFn func(elem ...string) string,
	extFn func(string) string,
) (string, error) {
	if policy == "" {
		policy = model.UploadConflictPolicyOverwrite
	}
	desiredPath := joinFn(targetDir, fileName)
	switch policy {
	case model.UploadConflictPolicyOverwrite:
		return desiredPath, nil
	case model.UploadConflictPolicyReject:
		exists, err := existsFn(desiredPath)
		if err != nil {
			return "", err
		}
		if exists {
			return "", util.NewStatusError(http.StatusBadRequest, "file already exists", nil)
		}
		return desiredPath, nil
	case model.UploadConflictPolicyRename:
		exists, err := existsFn(desiredPath)
		if err != nil {
			return "", err
		}
		if !exists {
			return desiredPath, nil
		}
		base := strings.TrimSuffix(fileName, extFn(fileName))
		ext := extFn(fileName)
		for idx := 1; idx < 1000; idx++ {
			candidate := joinFn(targetDir, fmt.Sprintf("%s (%d)%s", base, idx, ext))
			exists, err := existsFn(candidate)
			if err != nil {
				return "", err
			}
			if !exists {
				return candidate, nil
			}
		}
	}
	return "", util.NewStatusError(http.StatusBadRequest, "unable to resolve upload target", nil)
}

func isWithinLocalRoot(rootPath, targetPath string) bool {
	rootPath = filepath.Clean(rootPath)
	targetPath = filepath.Clean(targetPath)
	return targetPath == rootPath || strings.HasPrefix(targetPath, rootPath+string(os.PathSeparator))
}

func cleanRemotePath(value string) string {
	cleaned := path.Clean(value)
	if cleaned == "." {
		return "/"
	}
	return cleaned
}

func isWithinRemoteRoot(rootPath, targetPath string) bool {
	rootPath = cleanRemotePath(rootPath)
	targetPath = cleanRemotePath(targetPath)
	return targetPath == rootPath || strings.HasPrefix(targetPath, strings.TrimRight(rootPath, "/")+"/")
}

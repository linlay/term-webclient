package files

import (
	"archive/zip"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"sync"
	"time"

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

type fileGateway interface {
	Tree(targetPath string) (model.FileTreeResponse, error)
	Mkdir(parentPath, name string) (model.FileMkdirResponse, error)
	Upload(targetPath, fileName string, reader io.Reader, size int64, policy model.UploadConflictPolicy) (model.FileUploadItemResponse, error)
	OpenDownload(path string) (*DownloadHandle, error)
	ArchiveEntries(paths []string) ([]ArchiveEntry, int64, error)
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

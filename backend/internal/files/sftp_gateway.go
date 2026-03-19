package files

import (
	"io"
	"net/http"
	"os"
	"path"
	"sort"
	"strings"

	"github.com/pkg/sftp"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	sshsvc "term-webclient-go/backend/internal/ssh"
	"term-webclient-go/backend/internal/util"
)

type sftpGateway struct {
	rootPath     string
	credentialID string
	ssh          *sshsvc.Manager
	cfg          *config.Config
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

package files

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

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

func isWithinLocalRoot(rootPath, targetPath string) bool {
	rootPath = filepath.Clean(rootPath)
	targetPath = filepath.Clean(targetPath)
	return targetPath == rootPath || strings.HasPrefix(targetPath, rootPath+string(os.PathSeparator))
}

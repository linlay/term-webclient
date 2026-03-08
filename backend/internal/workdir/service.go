package workdir

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

type Service struct {
	rootPath string
}

func New(cfg *config.Config) (*Service, error) {
	rootPath := filepath.Clean(cfg.Terminal.WorkdirBrowseRoot)
	info, err := os.Stat(rootPath)
	if err != nil {
		return nil, util.NewStatusError(http.StatusInternalServerError, "terminal.workdir-browse-root must be an existing directory", err)
	}
	if !info.IsDir() {
		return nil, util.NewStatusError(http.StatusInternalServerError, "terminal.workdir-browse-root must be an existing directory", err)
	}
	return &Service{rootPath: rootPath}, nil
}

func (s *Service) Browse(path string) (model.WorkdirBrowseResponse, error) {
	targetPath := s.rootPath
	if strings.TrimSpace(path) != "" {
		targetPath = filepath.Clean(path)
		if !filepath.IsAbs(targetPath) {
			targetPath = filepath.Join(s.rootPath, targetPath)
		}
	}
	if !isWithinBrowseRoot(s.rootPath, targetPath) {
		return model.WorkdirBrowseResponse{}, util.NewStatusError(http.StatusBadRequest, "path must be inside browse root", nil)
	}
	info, err := os.Stat(targetPath)
	if err != nil {
		return model.WorkdirBrowseResponse{}, util.NewStatusError(http.StatusBadRequest, "path must be an existing directory", err)
	}
	if !info.IsDir() {
		return model.WorkdirBrowseResponse{}, util.NewStatusError(http.StatusBadRequest, "path must be an existing directory", err)
	}

	dirEntries, err := os.ReadDir(targetPath)
	if err != nil {
		return model.WorkdirBrowseResponse{}, util.NewStatusError(http.StatusInternalServerError, "failed to list directories", err)
	}

	entries := make([]model.WorkdirEntry, 0, len(dirEntries))
	for _, entry := range dirEntries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		childPath := filepath.Join(targetPath, entry.Name())
		entries = append(entries, model.WorkdirEntry{
			Name:        entry.Name(),
			Path:        childPath,
			HasChildren: hasVisibleSubdir(childPath),
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	return model.WorkdirBrowseResponse{
		RootPath:    s.rootPath,
		CurrentPath: targetPath,
		Entries:     entries,
	}, nil
}

func hasVisibleSubdir(path string) bool {
	dirEntries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, entry := range dirEntries {
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
			return true
		}
	}
	return false
}

func isWithinBrowseRoot(rootPath, targetPath string) bool {
	rel, err := filepath.Rel(filepath.Clean(rootPath), filepath.Clean(targetPath))
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))
}

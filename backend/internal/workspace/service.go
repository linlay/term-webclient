package workspace

import (
	"bytes"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

const maxSingleFileBytes = 128 * 1024

type Service struct {
	cfg           *config.Config
	workspaceRoot string
}

func New(cfg *config.Config) *Service {
	root, err := detectWorkspaceRoot()
	if err != nil {
		root = "."
	}
	return &Service{
		cfg:           cfg,
		workspaceRoot: root,
	}
}

func (s *Service) Pack(request model.ContextPackRequest) (model.ContextPackResponse, error) {
	maxBytes := s.cfg.Terminal.Agent.MaxContextPackBytes
	if request.MaxBytes != nil && *request.MaxBytes > 0 {
		maxBytes = *request.MaxBytes
	}
	if maxBytes < 4096 {
		maxBytes = 4096
	}

	remaining := maxBytes
	truncated := false
	entries := make([]model.ContextPackEntryResponse, 0, len(request.Paths))
	selectedPaths, err := s.normalizePaths(request.Paths)
	if err != nil {
		return model.ContextPackResponse{}, err
	}

	for _, selectedPath := range selectedPaths {
		if remaining <= 0 {
			entries = append(entries, model.ContextPackEntryResponse{
				Path:      selectedPath.DisplayPath,
				Found:     true,
				Truncated: true,
				Bytes:     0,
				Error:     "context byte budget exhausted",
			})
			truncated = true
			continue
		}
		entry := s.readEntry(selectedPath, remaining)
		entries = append(entries, entry)
		remaining -= entry.Bytes
		if entry.Truncated {
			truncated = true
		}
	}

	var gitDiff string
	includeGitDiff := request.IncludeGitDiff != nil && *request.IncludeGitDiff
	if includeGitDiff && remaining > 0 {
		gitDiff = s.readGitDiff(selectedPaths, remaining)
		if len(gitDiff) >= remaining {
			truncated = true
		}
	}

	return model.ContextPackResponse{
		GeneratedAt:   time.Now().UTC(),
		WorkspaceRoot: s.workspaceRoot,
		Truncated:     truncated,
		Entries:       entries,
		GitDiff:       gitDiff,
	}, nil
}

type pathWithDisplay struct {
	AbsPath     string
	DisplayPath string
}

func (s *Service) normalizePaths(rawPaths []string) ([]pathWithDisplay, error) {
	result := make([]pathWithDisplay, 0, len(rawPaths))
	for _, rawPath := range rawPaths {
		trimmed := strings.TrimSpace(rawPath)
		if trimmed == "" {
			continue
		}
		absPath := trimmed
		if !filepath.IsAbs(absPath) {
			absPath = filepath.Join(s.workspaceRoot, absPath)
		}
		absPath = filepath.Clean(absPath)
		if !strings.HasPrefix(absPath, s.workspaceRoot) {
			return nil, util.NewStatusError(http.StatusBadRequest, "path must be inside workspace root: "+trimmed, nil)
		}
		display := "."
		if rel, err := filepath.Rel(s.workspaceRoot, absPath); err == nil && rel != "." {
			display = rel
		}
		result = append(result, pathWithDisplay{
			AbsPath:     absPath,
			DisplayPath: display,
		})
	}
	return result, nil
}

func (s *Service) readEntry(selectedPath pathWithDisplay, remainingBudget int) model.ContextPackEntryResponse {
	info, err := os.Stat(selectedPath.AbsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return model.ContextPackEntryResponse{
				Path:  selectedPath.DisplayPath,
				Found: false,
				Error: "file does not exist",
			}
		}
		return model.ContextPackEntryResponse{
			Path:  selectedPath.DisplayPath,
			Found: true,
			Error: "failed to read file",
		}
	}
	if !info.Mode().IsRegular() {
		return model.ContextPackEntryResponse{
			Path:  selectedPath.DisplayPath,
			Found: true,
			Error: "not a regular file",
		}
	}

	fileBudget := min(remainingBudget, maxSingleFileBytes)
	payload, err := os.ReadFile(selectedPath.AbsPath)
	if err != nil {
		return model.ContextPackEntryResponse{
			Path:  selectedPath.DisplayPath,
			Found: true,
			Error: "failed to read file",
		}
	}
	truncated := len(payload) > fileBudget
	used := min(len(payload), fileBudget)
	return model.ContextPackEntryResponse{
		Path:      selectedPath.DisplayPath,
		Found:     true,
		Truncated: truncated,
		Bytes:     used,
		Content:   string(payload[:used]),
	}
}

func (s *Service) readGitDiff(selectedPaths []pathWithDisplay, maxChars int) string {
	args := []string{"-C", s.workspaceRoot, "diff"}
	if len(selectedPaths) > 0 {
		args = append(args, "--")
		for _, selectedPath := range selectedPaths {
			args = append(args, selectedPath.DisplayPath)
		}
	}
	cmd := exec.Command("git", args...)
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	if len(output) <= maxChars {
		return string(output)
	}
	return string(output[:maxChars])
}

func detectWorkspaceRoot() (string, error) {
	current, err := os.Getwd()
	if err != nil {
		return "", err
	}
	current = filepath.Clean(current)
	for {
		if _, err := os.Stat(filepath.Join(current, ".git")); err == nil {
			return current, nil
		}
		next := filepath.Dir(current)
		if next == current {
			return current, nil
		}
		current = next
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func trimToMax(text []byte, maxChars int) string {
	if len(text) <= maxChars {
		return string(text)
	}
	return string(bytes.TrimSpace(text[:maxChars]))
}

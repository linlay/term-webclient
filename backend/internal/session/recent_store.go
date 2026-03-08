package session

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
)

type RecentSessionRecord struct {
	Fingerprint string                     `json:"fingerprint"`
	ToolID      string                     `json:"toolId"`
	Title       string                     `json:"title"`
	SessionType model.SessionType          `json:"sessionType"`
	Workdir     string                     `json:"workdir"`
	LastUsedAt  time.Time                  `json:"lastUsedAt"`
	Request     model.CreateSessionRequest `json:"request"`
}

type recentSessionFile struct {
	Version       int                              `json:"version"`
	RecordsByTool map[string][]RecentSessionRecord `json:"recordsByTool"`
}

type RecentStore struct {
	mu    sync.Mutex
	path  string
	limit int
}

func NewRecentStore(cfg config.TerminalConfig) *RecentStore {
	return &RecentStore{
		path:  cfg.RecentSessionsFile,
		limit: max(1, cfg.RecentSessionsPerTool),
	}
}

func (s *RecentStore) Record(toolID, title string, sessionType model.SessionType, workdir string, request model.CreateSessionRequest) error {
	normalizedToolID := normalizeToolID(toolID)
	record := RecentSessionRecord{
		Fingerprint: fingerprintRequest(request),
		ToolID:      normalizedToolID,
		Title:       fallbackString(title, normalizedToolID),
		SessionType: model.NormalizeSessionType(sessionType),
		Workdir:     fallbackString(workdir, "."),
		LastUsedAt:  time.Now().UTC(),
		Request:     cloneRequest(request),
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.load()
	if err != nil {
		return err
	}
	records := file.RecordsByTool[normalizedToolID]
	filtered := make([]RecentSessionRecord, 0, len(records)+1)
	filtered = append(filtered, record)
	for _, existing := range records {
		if existing.Fingerprint == record.Fingerprint {
			continue
		}
		filtered = append(filtered, existing)
	}
	if len(filtered) > s.limit {
		filtered = filtered[:s.limit]
	}
	file.RecordsByTool[normalizedToolID] = filtered
	return s.persist(file)
}

func (s *RecentStore) ListByTool(toolID string) ([]RecentSessionRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.load()
	if err != nil {
		return nil, err
	}
	records := file.RecordsByTool[normalizeToolID(toolID)]
	return append([]RecentSessionRecord(nil), records...), nil
}

func (s *RecentStore) ReplaceToolRecords(toolID string, records []RecentSessionRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	file, err := s.load()
	if err != nil {
		return err
	}
	normalizedToolID := normalizeToolID(toolID)
	if len(records) == 0 {
		delete(file.RecordsByTool, normalizedToolID)
		return s.persist(file)
	}
	next := append([]RecentSessionRecord(nil), records...)
	if len(next) > s.limit {
		next = next[:s.limit]
	}
	file.RecordsByTool[normalizedToolID] = next
	return s.persist(file)
}

func (s *RecentStore) load() (*recentSessionFile, error) {
	if s.path == "" {
		s.path = "data/recent-sessions.json"
	}
	payload, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return &recentSessionFile{
				Version:       1,
				RecordsByTool: map[string][]RecentSessionRecord{},
			}, nil
		}
		return nil, err
	}
	if strings.TrimSpace(string(payload)) == "" {
		return &recentSessionFile{
			Version:       1,
			RecordsByTool: map[string][]RecentSessionRecord{},
		}, nil
	}
	var file recentSessionFile
	if err := json.Unmarshal(payload, &file); err != nil {
		return nil, err
	}
	if file.RecordsByTool == nil {
		file.RecordsByTool = map[string][]RecentSessionRecord{}
	}
	return &file, nil
}

func (s *RecentStore) persist(file *recentSessionFile) error {
	if file.RecordsByTool == nil {
		file.RecordsByTool = map[string][]RecentSessionRecord{}
	}
	payload, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tempFile := s.path + ".tmp"
	if err := os.WriteFile(tempFile, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tempFile, s.path)
}

func fingerprintRequest(request model.CreateSessionRequest) string {
	payload, _ := json.Marshal(request)
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func cloneRequest(request model.CreateSessionRequest) model.CreateSessionRequest {
	payload, _ := json.Marshal(request)
	var cloned model.CreateSessionRequest
	_ = json.Unmarshal(payload, &cloned)
	return cloned
}

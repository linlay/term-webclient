package sshsvc

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	gossh "golang.org/x/crypto/ssh"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/util"
)

type knownHostStore struct {
	mu   sync.Mutex
	path string
}

type knownHostFile struct {
	Version int              `json:"version"`
	Entries []knownHostEntry `json:"entries"`
}

type knownHostEntry struct {
	Host              string `json:"host"`
	Port              int    `json:"port"`
	FingerprintSHA256 string `json:"fingerprintSha256"`
}

func newKnownHostStore(cfg config.SSHConfig) *knownHostStore {
	return &knownHostStore{path: cfg.KnownHostsFile}
}

func (s *knownHostStore) Verify(host string, port int, key gossh.PublicKey) error {
	if strings.TrimSpace(host) == "" || port <= 0 || key == nil {
		return util.NewStatusError(http.StatusBadRequest, "invalid host key verification request", nil)
	}
	fingerprint := gossh.FingerprintSHA256(key)

	s.mu.Lock()
	defer s.mu.Unlock()

	file, err := s.load()
	if err != nil {
		return err
	}
	for _, entry := range file.Entries {
		if entry.Host == host && entry.Port == port {
			if entry.FingerprintSHA256 != fingerprint {
				return util.NewStatusError(http.StatusBadRequest, "host key fingerprint mismatch", nil)
			}
			return nil
		}
	}
	file.Entries = append(file.Entries, knownHostEntry{
		Host:              host,
		Port:              port,
		FingerprintSHA256: fingerprint,
	})
	return s.persist(file)
}

func (s *knownHostStore) load() (*knownHostFile, error) {
	payload, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return &knownHostFile{
				Version: 1,
				Entries: []knownHostEntry{},
			}, nil
		}
		return nil, util.NewStatusError(http.StatusBadRequest, "Failed to read known hosts file", err)
	}
	if strings.TrimSpace(string(payload)) == "" {
		return &knownHostFile{
			Version: 1,
			Entries: []knownHostEntry{},
		}, nil
	}
	var file knownHostFile
	if err := json.Unmarshal(payload, &file); err != nil {
		return nil, util.NewStatusError(http.StatusBadRequest, "Failed to parse known hosts file", err)
	}
	if file.Entries == nil {
		file.Entries = []knownHostEntry{}
	}
	return &file, nil
}

func (s *knownHostStore) persist(file *knownHostFile) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return util.NewStatusError(http.StatusBadRequest, "Failed to create known hosts dir", err)
	}
	payload, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return util.NewStatusError(http.StatusBadRequest, "Failed to encode known hosts file", err)
	}
	tempPath := s.path + ".tmp"
	if err := os.WriteFile(tempPath, payload, 0o600); err != nil {
		return util.NewStatusError(http.StatusBadRequest, "Failed to write known hosts file", err)
	}
	if err := os.Rename(tempPath, s.path); err != nil {
		return util.NewStatusError(http.StatusBadRequest, "Failed to persist known hosts file", err)
	}
	return nil
}

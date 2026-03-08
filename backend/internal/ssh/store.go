package sshsvc

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

type ResolvedCredential struct {
	CredentialID         string
	Host                 string
	Port                 int
	Username             string
	Term                 string
	AuthType             model.SshAuthType
	Password             string
	PrivateKey           string
	PrivateKeyPassphrase string
}

type credentialStore struct {
	mu          sync.Mutex
	cfg         config.SSHConfig
	defaultPort int
}

type credentialFile struct {
	Version     int                `json:"version"`
	Credentials []storedCredential `json:"credentials"`
}

type storedCredential struct {
	CredentialID    string            `json:"credentialId"`
	Title           string            `json:"title,omitempty"`
	Host            string            `json:"host"`
	Port            int               `json:"port"`
	Username        string            `json:"username"`
	AuthType        model.SshAuthType `json:"authType"`
	CreatedAt       time.Time         `json:"createdAt"`
	UpdatedAt       *time.Time        `json:"updatedAt,omitempty"`
	EncryptedSecret string            `json:"encryptedSecret"`
}

type secretPayload struct {
	Password             string `json:"password,omitempty"`
	PrivateKey           string `json:"privateKey,omitempty"`
	PrivateKeyPassphrase string `json:"privateKeyPassphrase,omitempty"`
}

func newCredentialStore(cfg config.SSHConfig) *credentialStore {
	return &credentialStore{
		cfg:         cfg,
		defaultPort: cfg.DefaultPort,
	}
}

func (s *credentialStore) CreateCredential(request model.CreateSshCredentialRequest) (model.SshCredentialResponse, error) {
	if !s.cfg.Enabled {
		return model.SshCredentialResponse{}, util.NewStatusError(http.StatusBadRequest, "SSH is disabled", nil)
	}
	if err := s.validateCreateRequest(request); err != nil {
		return model.SshCredentialResponse{}, err
	}

	authType := model.SshAuthPassword
	if strings.TrimSpace(request.PrivateKey) != "" {
		authType = model.SshAuthPrivateKey
	}
	port := s.defaultPort
	if request.Port != nil {
		port = *request.Port
	}
	now := time.Now().UTC()
	stored := storedCredential{
		CredentialID: util.NewID(),
		Title:        strings.TrimSpace(request.Title),
		Host:         strings.TrimSpace(request.Host),
		Port:         port,
		Username:     strings.TrimSpace(request.Username),
		AuthType:     authType,
		CreatedAt:    now,
	}
	secretJSON, _ := json.Marshal(secretPayload{
		Password:             request.Password,
		PrivateKey:           request.PrivateKey,
		PrivateKeyPassphrase: request.PrivateKeyPassphrase,
	})
	encryptedSecret, err := s.encrypt(string(secretJSON))
	if err != nil {
		return model.SshCredentialResponse{}, err
	}
	stored.EncryptedSecret = encryptedSecret

	s.mu.Lock()
	defer s.mu.Unlock()

	file, err := s.load()
	if err != nil {
		return model.SshCredentialResponse{}, err
	}
	file.Credentials = append(file.Credentials, stored)
	if err := s.persist(file); err != nil {
		return model.SshCredentialResponse{}, err
	}
	return model.SshCredentialResponse{
		CredentialID: stored.CredentialID,
		Title:        stored.Title,
		Host:         stored.Host,
		Port:         stored.Port,
		Username:     stored.Username,
		AuthType:     stored.AuthType,
		CreatedAt:    stored.CreatedAt,
	}, nil
}

func (s *credentialStore) ResolveCredential(credentialID, overrideHost string, overridePort *int, overrideUsername, overrideTerm string) (ResolvedCredential, error) {
	if strings.TrimSpace(credentialID) == "" {
		return ResolvedCredential{}, util.NewStatusError(http.StatusBadRequest, "credentialId is required", nil)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	file, err := s.load()
	if err != nil {
		return ResolvedCredential{}, err
	}
	for _, item := range file.Credentials {
		if item.CredentialID != credentialID {
			continue
		}
		secretJSON, err := s.decrypt(item.EncryptedSecret)
		if err != nil {
			return ResolvedCredential{}, err
		}
		var secret secretPayload
		if err := json.Unmarshal([]byte(secretJSON), &secret); err != nil {
			return ResolvedCredential{}, util.NewStatusError(http.StatusBadRequest, "Failed to decode credential secret", err)
		}
		host := strings.TrimSpace(overrideHost)
		if host == "" {
			host = item.Host
		}
		port := item.Port
		if overridePort != nil {
			port = *overridePort
		}
		username := strings.TrimSpace(overrideUsername)
		if username == "" {
			username = item.Username
		}
		term := strings.TrimSpace(overrideTerm)
		if term == "" {
			term = s.cfg.DefaultTerm
		}
		if host == "" || username == "" {
			return ResolvedCredential{}, util.NewStatusError(http.StatusBadRequest, "Resolved SSH target is missing host or username", nil)
		}
		return ResolvedCredential{
			CredentialID:         item.CredentialID,
			Host:                 host,
			Port:                 port,
			Username:             username,
			Term:                 term,
			AuthType:             item.AuthType,
			Password:             secret.Password,
			PrivateKey:           secret.PrivateKey,
			PrivateKeyPassphrase: secret.PrivateKeyPassphrase,
		}, nil
	}
	return ResolvedCredential{}, util.NewStatusError(http.StatusNotFound, "credential not found", nil)
}

func (s *credentialStore) ListCredentials() ([]model.SshCredentialResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	file, err := s.load()
	if err != nil {
		return nil, err
	}
	result := make([]model.SshCredentialResponse, 0, len(file.Credentials))
	for _, item := range file.Credentials {
		result = append(result, model.SshCredentialResponse{
			CredentialID: item.CredentialID,
			Title:        item.Title,
			Host:         item.Host,
			Port:         item.Port,
			Username:     item.Username,
			AuthType:     item.AuthType,
			CreatedAt:    item.CreatedAt,
			UpdatedAt:    item.UpdatedAt,
		})
	}
	return result, nil
}

func (s *credentialStore) DeleteCredential(credentialID string) error {
	if strings.TrimSpace(credentialID) == "" {
		return util.NewStatusError(http.StatusBadRequest, "credentialId is required", nil)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	file, err := s.load()
	if err != nil {
		return err
	}
	next := make([]storedCredential, 0, len(file.Credentials))
	removed := false
	for _, item := range file.Credentials {
		if item.CredentialID == credentialID {
			removed = true
			continue
		}
		next = append(next, item)
	}
	if !removed {
		return util.NewStatusError(http.StatusNotFound, "credential not found", nil)
	}
	file.Credentials = next
	return s.persist(file)
}

func (s *credentialStore) ListCredentialIDs() ([]string, error) {
	credentials, err := s.ListCredentials()
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(credentials))
	for _, item := range credentials {
		result = append(result, item.CredentialID)
	}
	return result, nil
}

func (s *credentialStore) load() (*credentialFile, error) {
	payload, err := os.ReadFile(s.cfg.CredentialsFile)
	if err != nil {
		if os.IsNotExist(err) {
			return &credentialFile{
				Version:     1,
				Credentials: []storedCredential{},
			}, nil
		}
		return nil, util.NewStatusError(http.StatusBadRequest, "Failed to read credential store", err)
	}
	if strings.TrimSpace(string(payload)) == "" {
		return &credentialFile{
			Version:     1,
			Credentials: []storedCredential{},
		}, nil
	}
	var file credentialFile
	if err := json.Unmarshal(payload, &file); err != nil {
		return nil, util.NewStatusError(http.StatusBadRequest, "Failed to parse credential store", err)
	}
	if file.Credentials == nil {
		file.Credentials = []storedCredential{}
	}
	return &file, nil
}

func (s *credentialStore) persist(file *credentialFile) error {
	if err := os.MkdirAll(filepath.Dir(s.cfg.CredentialsFile), 0o755); err != nil {
		return util.NewStatusError(http.StatusBadRequest, "Failed to create credential store dir", err)
	}
	payload, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return util.NewStatusError(http.StatusBadRequest, "Failed to encode credential store", err)
	}
	tempPath := s.cfg.CredentialsFile + ".tmp"
	if err := os.WriteFile(tempPath, payload, 0o600); err != nil {
		return util.NewStatusError(http.StatusBadRequest, "Failed to write credential store", err)
	}
	if err := os.Rename(tempPath, s.cfg.CredentialsFile); err != nil {
		return util.NewStatusError(http.StatusBadRequest, "Failed to persist credential store", err)
	}
	return nil
}

func (s *credentialStore) validateCreateRequest(request model.CreateSshCredentialRequest) error {
	if strings.TrimSpace(request.Host) == "" {
		return util.NewStatusError(http.StatusBadRequest, "host must not be blank", nil)
	}
	if strings.TrimSpace(request.Username) == "" {
		return util.NewStatusError(http.StatusBadRequest, "username must not be blank", nil)
	}
	hasPassword := strings.TrimSpace(request.Password) != ""
	hasPrivateKey := strings.TrimSpace(request.PrivateKey) != ""
	if hasPassword == hasPrivateKey {
		return util.NewStatusError(http.StatusBadRequest, "Provide exactly one auth secret: password or privateKey", nil)
	}
	if request.Port != nil && (*request.Port <= 0 || *request.Port > 65535) {
		return util.NewStatusError(http.StatusBadRequest, "port must be between 1 and 65535", nil)
	}
	return nil
}

func (s *credentialStore) encrypt(plaintext string) (string, error) {
	key, err := s.masterKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", util.NewStatusError(http.StatusBadRequest, "Credential encryption failed", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", util.NewStatusError(http.StatusBadRequest, "Credential encryption failed", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", util.NewStatusError(http.StatusBadRequest, "Credential encryption failed", err)
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	merged := append(nonce, sealed...)
	return base64.StdEncoding.EncodeToString(merged), nil
}

func (s *credentialStore) decrypt(encoded string) (string, error) {
	key, err := s.masterKey()
	if err != nil {
		return "", err
	}
	merged, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", util.NewStatusError(http.StatusBadRequest, "Credential decryption failed", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", util.NewStatusError(http.StatusBadRequest, "Credential decryption failed", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", util.NewStatusError(http.StatusBadRequest, "Credential decryption failed", err)
	}
	if len(merged) < gcm.NonceSize() {
		return "", util.NewStatusError(http.StatusBadRequest, "Credential payload is invalid", nil)
	}
	nonce := merged[:gcm.NonceSize()]
	cipherText := merged[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, cipherText, nil)
	if err != nil {
		return "", util.NewStatusError(http.StatusBadRequest, "Credential decryption failed", err)
	}
	return string(plain), nil
}

func (s *credentialStore) masterKey() ([]byte, error) {
	rawKey := strings.TrimSpace(s.cfg.MasterKey)
	if rawKey == "" {
		return nil, util.NewStatusError(http.StatusBadRequest, "Missing SSH credential master key in terminal.ssh.master-key", nil)
	}
	sum := sha256.Sum256([]byte(rawKey))
	return sum[:], nil
}

func validateShellEnvKey(key string) error {
	if key == "" {
		return util.NewStatusError(http.StatusBadRequest, "Invalid env key", nil)
	}
	for idx, ch := range key {
		switch {
		case ch >= 'A' && ch <= 'Z':
		case ch >= 'a' && ch <= 'z':
		case idx > 0 && ch >= '0' && ch <= '9':
		case ch == '_':
		default:
			return util.NewStatusError(http.StatusBadRequest, fmt.Sprintf("Invalid env key: %s", key), nil)
		}
	}
	return nil
}

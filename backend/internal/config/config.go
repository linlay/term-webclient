package config

import (
	_ "embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed application.yml
var embeddedDefaults []byte

var envPlaceholderPattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}`)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Terminal TerminalConfig `yaml:"terminal"`
	Assist   AssistConfig   `yaml:"assist"`
	Auth     AuthConfig     `yaml:"auth"`
	AppAuth  AppAuthConfig  `yaml:"app-auth"`
	App      AppMetaConfig  `yaml:"app"`
}

type ServerConfig struct {
	Address string `yaml:"address"`
	Port    int    `yaml:"port"`
}

type TerminalConfig struct {
	DefaultCommand         string            `yaml:"default-command"`
	DefaultArgs            []string          `yaml:"default-args"`
	DefaultWorkdir         string            `yaml:"default-workdir"`
	WorkdirBrowseRoot      string            `yaml:"workdir-browse-root"`
	AllowedOrigins         []string          `yaml:"allowed-origins"`
	DetachedSessionTTL     int               `yaml:"detached-session-ttl-seconds"`
	RingBufferMaxBytes     int               `yaml:"ring-buffer-max-bytes"`
	RingBufferMaxChunks    int               `yaml:"ring-buffer-max-chunks"`
	MaxCols                int               `yaml:"max-cols"`
	MaxRows                int               `yaml:"max-rows"`
	SessionEventMaxEntries int               `yaml:"session-event-max-entries"`
	CommandFrameMaxEntries int               `yaml:"command-frame-max-entries"`
	TranscriptMaxChars     int               `yaml:"transcript-max-chars"`
	RecentSessionsFile     string            `yaml:"recent-sessions-file"`
	RecentSessionsPerTool  int               `yaml:"recent-sessions-per-tool"`
	CliClients             []CLIClientConfig `yaml:"cli-clients"`
	Agent                  AgentConfig       `yaml:"agent"`
	SSH                    SSHConfig         `yaml:"ssh"`
	Files                  FilesConfig       `yaml:"files"`
}

type CLIClientConfig struct {
	ID          string            `yaml:"id"`
	Label       string            `yaml:"label"`
	Command     string            `yaml:"command"`
	Args        []string          `yaml:"args"`
	Workdir     string            `yaml:"workdir"`
	Env         map[string]string `yaml:"env"`
	PreCommands []string          `yaml:"pre-commands"`
	Shell       string            `yaml:"shell"`
}

type AgentConfig struct {
	Enabled             bool `yaml:"enabled"`
	StepTimeoutSeconds  int  `yaml:"step-timeout-seconds"`
	MaxStepResultChars  int  `yaml:"max-step-result-chars"`
	MaxContextPackBytes int  `yaml:"max-context-pack-bytes"`
}

type SSHConfig struct {
	Enabled                   bool   `yaml:"enabled"`
	DefaultPort               int    `yaml:"default-port"`
	DefaultTerm               string `yaml:"default-term"`
	ConnectTimeoutMillis      int    `yaml:"connect-timeout-millis"`
	ConnectionIdleTTLSeconds  int    `yaml:"connection-idle-ttl-seconds"`
	ExecDefaultTimeoutSeconds int    `yaml:"exec-default-timeout-seconds"`
	ExecMaxOutputBytes        int    `yaml:"exec-max-output-bytes"`
	CredentialsFile           string `yaml:"credentials-file"`
	KnownHostsFile            string `yaml:"known-hosts-file"`
	MasterKey                 string `yaml:"master-key"`
}

type FilesConfig struct {
	Enabled                  bool     `yaml:"enabled"`
	MaxUploadFileBytes       int64    `yaml:"max-upload-file-bytes"`
	MaxUploadRequestBytes    int64    `yaml:"max-upload-request-bytes"`
	MaxDownloadArchiveBytes  int64    `yaml:"max-download-archive-bytes"`
	DefaultRootScope         string   `yaml:"default-root-scope"`
	AllowOutsideRoot         bool     `yaml:"allow-outside-root"`
	AllowedRoots             []string `yaml:"allowed-roots"`
	DownloadTicketTTLSeconds int      `yaml:"download-ticket-ttl-seconds"`
}

type AssistConfig struct {
	Enabled            bool   `yaml:"enabled"`
	BaseURL            string `yaml:"base-url"`
	APIKey             string `yaml:"api-key"`
	Model              string `yaml:"model"`
	TimeoutSeconds     int    `yaml:"timeout-seconds"`
	MaxScreenTextChars int    `yaml:"max-screen-text-chars"`
	DebugLog           bool   `yaml:"debug-log"`
	SystemPrompt       string `yaml:"system-prompt"`
}

type AuthConfig struct {
	Enabled                     bool   `yaml:"enabled"`
	Username                    string `yaml:"username"`
	PasswordHashBcrypt          string `yaml:"password-hash-bcrypt"`
	SessionTTLSeconds           int    `yaml:"session-ttl-seconds"`
	LoginRateLimitEnabled       bool   `yaml:"login-rate-limit-enabled"`
	LoginRateLimitWindowSeconds int    `yaml:"login-rate-limit-window-seconds"`
	LoginRateLimitMaxAttempts   int    `yaml:"login-rate-limit-max-attempts"`
}

type AppAuthConfig struct {
	Enabled          bool   `yaml:"enabled"`
	LocalPublicKey   string `yaml:"local-public-key"`
	JWKSURI          string `yaml:"jwks-uri"`
	Issuer           string `yaml:"issuer"`
	JWKSCacheSeconds int    `yaml:"jwks-cache-seconds"`
	Audience         string `yaml:"audience"`
	ClockSkewSeconds int    `yaml:"clock-skew-seconds"`
}

type AppMetaConfig struct {
	Name      string `yaml:"name"`
	Version   string `yaml:"version"`
	GitSHA    string `yaml:"git-sha"`
	BuildTime string `yaml:"build-time"`
}

func defaultConfig() *Config {
	home, _ := os.UserHomeDir()
	return &Config{
		Server: ServerConfig{
			Address: "127.0.0.1",
			Port:    8080,
		},
		Terminal: TerminalConfig{
			DefaultCommand:         "codex",
			DefaultArgs:            []string{},
			DefaultWorkdir:         ".",
			WorkdirBrowseRoot:      home,
			AllowedOrigins:         []string{"http://*", "https://*"},
			DetachedSessionTTL:     3600,
			RingBufferMaxBytes:     4 * 1024 * 1024,
			RingBufferMaxChunks:    4096,
			MaxCols:                500,
			MaxRows:                200,
			SessionEventMaxEntries: 2048,
			CommandFrameMaxEntries: 256,
			TranscriptMaxChars:     200000,
			RecentSessionsFile:     "data/recent-sessions.json",
			RecentSessionsPerTool:  5,
			CliClients: []CLIClientConfig{
				{
					ID:      "codex",
					Label:   "Codex",
					Command: "codex",
					Args:    []string{},
					Workdir: ".",
					Env:     map[string]string{},
					Shell:   "/bin/zsh",
				},
				{
					ID:      "claude",
					Label:   "Claude Code",
					Command: "claude",
					Args:    []string{},
					Workdir: ".",
					Env:     map[string]string{},
					Shell:   "/bin/zsh",
				},
			},
			Agent: AgentConfig{
				Enabled:             true,
				StepTimeoutSeconds:  15,
				MaxStepResultChars:  8000,
				MaxContextPackBytes: 256 * 1024,
			},
			SSH: SSHConfig{
				Enabled:                   true,
				DefaultPort:               22,
				DefaultTerm:               "xterm-256color",
				ConnectTimeoutMillis:      10000,
				ConnectionIdleTTLSeconds:  3600,
				ExecDefaultTimeoutSeconds: 120,
				ExecMaxOutputBytes:        1024 * 1024,
				CredentialsFile:           "data/ssh-credentials.json",
				KnownHostsFile:            filepath.Join(home, ".term-web", "known-hosts.json"),
			},
			Files: FilesConfig{
				Enabled:                  false,
				MaxUploadFileBytes:       200 * 1024 * 1024,
				MaxUploadRequestBytes:    500 * 1024 * 1024,
				MaxDownloadArchiveBytes:  1024 * 1024 * 1024,
				DefaultRootScope:         "SESSION_WORKDIR",
				AllowOutsideRoot:         false,
				AllowedRoots:             []string{},
				DownloadTicketTTLSeconds: 60,
			},
		},
		Assist: AssistConfig{
			Enabled:            false,
			BaseURL:            "https://api.openai.com/v1",
			Model:              "",
			TimeoutSeconds:     30,
			MaxScreenTextChars: 500,
		},
		Auth: AuthConfig{
			Enabled:                     false,
			Username:                    "admin",
			PasswordHashBcrypt:          "",
			SessionTTLSeconds:           43200,
			LoginRateLimitEnabled:       true,
			LoginRateLimitWindowSeconds: 60,
			LoginRateLimitMaxAttempts:   10,
		},
		AppAuth: AppAuthConfig{
			Enabled:          false,
			JWKSCacheSeconds: 300,
			ClockSkewSeconds: 30,
		},
		App: AppMetaConfig{
			Name:      "term-web-backend",
			Version:   "0.0.1-SNAPSHOT",
			GitSHA:    getenv("APP_GIT_SHA", "unknown"),
			BuildTime: getenv("APP_BUILD_TIME", "unknown"),
		},
	}
}

func Load() (*Config, error) {
	cfg := defaultConfig()
	effectiveValues := envToMap(os.Environ())

	overrides, err := loadEnvFiles()
	if err != nil {
		return nil, err
	}
	for key, value := range overrides {
		effectiveValues[key] = value
	}
	for key, value := range envToMap(os.Environ()) {
		effectiveValues[key] = value
	}

	if err := mergeYAMLBytes(cfg, embeddedDefaults, effectiveValues, "embedded application.yml"); err != nil {
		return nil, err
	}
	if configPath := strings.TrimSpace(effectiveValues["CONFIG_PATH"]); configPath != "" {
		if err := mergeYAMLFile(cfg, configPath, effectiveValues, true); err != nil {
			return nil, err
		}
	}

	applyEnvMap(cfg, overrides)
	applyEnvMap(cfg, envToMap(os.Environ()))

	if err := validate(cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) BindAddr() string {
	return fmt.Sprintf("%s:%d", c.Server.Address, c.Server.Port)
}

func envCandidates() []string {
	cwd, _ := os.Getwd()
	return dedupeStrings([]string{
		filepath.Join(cwd, "..", ".env"),
		filepath.Join(cwd, ".env"),
	})
}

func mergeYAMLFile(cfg *Config, filePath string, placeholderValues map[string]string, required bool) error {
	info, err := os.Stat(filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			if required {
				return fmt.Errorf("required config file not found: %s", filePath)
			}
			return nil
		}
		return fmt.Errorf("stat %s: %w", filePath, err)
	}
	if info.IsDir() {
		if required {
			return fmt.Errorf("required config path is a directory: %s", filePath)
		}
		return nil
	}
	payload, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("read %s: %w", filePath, err)
	}
	return mergeYAMLBytes(cfg, payload, placeholderValues, filePath)
}

func mergeYAMLBytes(cfg *Config, payload []byte, placeholderValues map[string]string, source string) error {
	if len(strings.TrimSpace(string(payload))) == 0 {
		return nil
	}
	payload = []byte(expandEnvPlaceholders(string(payload), placeholderValues))
	if err := yaml.Unmarshal(payload, cfg); err != nil {
		return fmt.Errorf("parse %s: %w", source, err)
	}
	return nil
}

func loadEnvFiles() (map[string]string, error) {
	result := map[string]string{}
	for _, filePath := range envCandidates() {
		info, err := os.Stat(filePath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, fmt.Errorf("stat %s: %w", filePath, err)
		}
		if info.IsDir() {
			continue
		}
		values, err := parseEnvFile(filePath)
		if err != nil {
			return nil, err
		}
		for k, v := range values {
			result[k] = v
		}
	}
	return result, nil
}

func parseEnvFile(filePath string) (map[string]string, error) {
	payload, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", filePath, err)
	}
	return parseEnvLines(string(payload)), nil
}

func parseEnvLines(text string) map[string]string {
	result := map[string]string{}
	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		idx := strings.Index(line, "=")
		if idx <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		value := strings.TrimSpace(line[idx+1:])
		value = trimEnvQuotes(value)
		result[key] = value
	}
	return result
}

func trimEnvQuotes(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) >= 2 {
		first := trimmed[0]
		last := trimmed[len(trimmed)-1]
		if (first == '\'' && last == '\'') || (first == '"' && last == '"') {
			return strings.TrimSpace(trimmed[1 : len(trimmed)-1])
		}
	}
	if hashIdx := strings.Index(trimmed, " #"); hashIdx >= 0 {
		return strings.TrimSpace(trimmed[:hashIdx])
	}
	return trimmed
}

func expandEnvPlaceholders(text string, values map[string]string) string {
	return envPlaceholderPattern.ReplaceAllStringFunc(text, func(match string) string {
		parts := envPlaceholderPattern.FindStringSubmatch(match)
		if len(parts) != 3 {
			return match
		}
		if value, ok := values[parts[1]]; ok && value != "" {
			return value
		}
		return parts[2]
	})
}

func envToMap(items []string) map[string]string {
	result := map[string]string{}
	for _, item := range items {
		idx := strings.Index(item, "=")
		if idx <= 0 {
			continue
		}
		result[item[:idx]] = item[idx+1:]
	}
	return result
}

func applyEnvMap(cfg *Config, values map[string]string) {
	if len(values) == 0 {
		return
	}

	cfg.Server.Address = getenvMap(values, "BACKEND_HOST", cfg.Server.Address)
	cfg.Server.Port = getenvIntMap(values, "BACKEND_PORT", cfg.Server.Port)

	cfg.Terminal.RecentSessionsFile = getenvMap(values, "TERMINAL_RECENT_SESSIONS_FILE", cfg.Terminal.RecentSessionsFile)
	cfg.Terminal.RecentSessionsPerTool = getenvIntMap(values, "TERMINAL_RECENT_SESSIONS_PER_TOOL", cfg.Terminal.RecentSessionsPerTool)
	cfg.Terminal.Files.Enabled = getenvBoolMap(values, "TERMINAL_FILES_ENABLED", cfg.Terminal.Files.Enabled)
	cfg.Terminal.SSH.CredentialsFile = getenvMap(values, "TERMINAL_SSH_CREDENTIALS_FILE", cfg.Terminal.SSH.CredentialsFile)
	cfg.Terminal.SSH.MasterKey = getenvMap(values, "TERMINAL_SSH_MASTER_KEY", cfg.Terminal.SSH.MasterKey)

	cfg.Auth.Enabled = getenvBoolMap(values, "AUTH_ENABLED", cfg.Auth.Enabled)
	cfg.Auth.Username = getenvMap(values, "AUTH_USERNAME", cfg.Auth.Username)
	cfg.Auth.PasswordHashBcrypt = getenvMap(values, "AUTH_PASSWORD_HASH_BCRYPT", cfg.Auth.PasswordHashBcrypt)
	cfg.Auth.SessionTTLSeconds = getenvIntMap(values, "AUTH_SESSION_TTL_SECONDS", cfg.Auth.SessionTTLSeconds)
	cfg.Auth.LoginRateLimitEnabled = getenvBoolMap(values, "AUTH_LOGIN_RATE_LIMIT_ENABLED", cfg.Auth.LoginRateLimitEnabled)
	cfg.Auth.LoginRateLimitWindowSeconds = getenvIntMap(values, "AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS", cfg.Auth.LoginRateLimitWindowSeconds)
	cfg.Auth.LoginRateLimitMaxAttempts = getenvIntMap(values, "AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS", cfg.Auth.LoginRateLimitMaxAttempts)

	cfg.AppAuth.Enabled = getenvBoolMap(values, "APP_AUTH_ENABLED", cfg.AppAuth.Enabled)
	cfg.AppAuth.LocalPublicKey = getenvMap(values, "APP_AUTH_LOCAL_PUBLIC_KEY", cfg.AppAuth.LocalPublicKey)
	cfg.AppAuth.JWKSURI = getenvMap(values, "APP_AUTH_JWKS_URI", cfg.AppAuth.JWKSURI)
	cfg.AppAuth.Issuer = getenvMap(values, "APP_AUTH_ISSUER", cfg.AppAuth.Issuer)
	cfg.AppAuth.JWKSCacheSeconds = getenvIntMap(values, "APP_AUTH_JWKS_CACHE_SECONDS", cfg.AppAuth.JWKSCacheSeconds)
	cfg.AppAuth.Audience = getenvMap(values, "APP_AUTH_AUDIENCE", cfg.AppAuth.Audience)
	cfg.AppAuth.ClockSkewSeconds = getenvIntMap(values, "APP_AUTH_CLOCK_SKEW_SECONDS", cfg.AppAuth.ClockSkewSeconds)

	cfg.Assist.Enabled = getenvBoolMap(values, "ASSIST_ENABLED", cfg.Assist.Enabled)
	cfg.Assist.BaseURL = getenvMap(values, "ASSIST_BASE_URL", cfg.Assist.BaseURL)
	cfg.Assist.APIKey = getenvMap(values, "ASSIST_API_KEY", cfg.Assist.APIKey)
	cfg.Assist.Model = getenvMap(values, "ASSIST_MODEL", cfg.Assist.Model)
	cfg.Assist.TimeoutSeconds = getenvIntMap(values, "ASSIST_TIMEOUT_SECONDS", cfg.Assist.TimeoutSeconds)
	cfg.Assist.MaxScreenTextChars = getenvIntMap(values, "ASSIST_MAX_SCREEN_TEXT_CHARS", cfg.Assist.MaxScreenTextChars)
	cfg.Assist.DebugLog = getenvBoolMap(values, "ASSIST_DEBUG_LOG", cfg.Assist.DebugLog)
	cfg.Assist.SystemPrompt = getenvMap(values, "ASSIST_SYSTEM_PROMPT", cfg.Assist.SystemPrompt)

	cfg.App.GitSHA = getenvMap(values, "APP_GIT_SHA", cfg.App.GitSHA)
	cfg.App.BuildTime = getenvMap(values, "APP_BUILD_TIME", cfg.App.BuildTime)
}

func validate(cfg *Config) error {
	if strings.TrimSpace(cfg.Server.Address) == "" {
		cfg.Server.Address = "127.0.0.1"
	}
	if cfg.Server.Port <= 0 || cfg.Server.Port > 65535 {
		return fmt.Errorf("invalid backend port: %d", cfg.Server.Port)
	}
	if cfg.Terminal.WorkdirBrowseRoot == "" {
		home, _ := os.UserHomeDir()
		cfg.Terminal.WorkdirBrowseRoot = home
	}
	if cfg.Terminal.MaxCols <= 0 {
		cfg.Terminal.MaxCols = 500
	}
	if cfg.Terminal.MaxRows <= 0 {
		cfg.Terminal.MaxRows = 200
	}
	if cfg.Terminal.DetachedSessionTTL <= 0 {
		cfg.Terminal.DetachedSessionTTL = 3600
	}
	if cfg.Terminal.RingBufferMaxBytes <= 0 {
		cfg.Terminal.RingBufferMaxBytes = 4 * 1024 * 1024
	}
	if cfg.Terminal.RingBufferMaxChunks <= 0 {
		cfg.Terminal.RingBufferMaxChunks = 4096
	}
	if cfg.Terminal.SessionEventMaxEntries <= 0 {
		cfg.Terminal.SessionEventMaxEntries = 2048
	}
	if cfg.Terminal.CommandFrameMaxEntries <= 0 {
		cfg.Terminal.CommandFrameMaxEntries = 256
	}
	if cfg.Terminal.TranscriptMaxChars <= 0 {
		cfg.Terminal.TranscriptMaxChars = 200000
	}
	if cfg.Terminal.RecentSessionsPerTool <= 0 {
		cfg.Terminal.RecentSessionsPerTool = 5
	}
	if cfg.Terminal.Agent.StepTimeoutSeconds <= 0 {
		cfg.Terminal.Agent.StepTimeoutSeconds = 15
	}
	if cfg.Terminal.Agent.MaxStepResultChars <= 0 {
		cfg.Terminal.Agent.MaxStepResultChars = 8000
	}
	if cfg.Terminal.Agent.MaxContextPackBytes <= 0 {
		cfg.Terminal.Agent.MaxContextPackBytes = 256 * 1024
	}
	if cfg.Terminal.SSH.DefaultPort <= 0 {
		cfg.Terminal.SSH.DefaultPort = 22
	}
	if cfg.Terminal.SSH.DefaultTerm == "" {
		cfg.Terminal.SSH.DefaultTerm = "xterm-256color"
	}
	if cfg.Terminal.SSH.ConnectTimeoutMillis <= 0 {
		cfg.Terminal.SSH.ConnectTimeoutMillis = 10000
	}
	if cfg.Terminal.SSH.ExecDefaultTimeoutSeconds <= 0 {
		cfg.Terminal.SSH.ExecDefaultTimeoutSeconds = 120
	}
	if cfg.Terminal.SSH.ExecMaxOutputBytes <= 0 {
		cfg.Terminal.SSH.ExecMaxOutputBytes = 1024 * 1024
	}
	if cfg.Terminal.Files.DownloadTicketTTLSeconds <= 0 {
		cfg.Terminal.Files.DownloadTicketTTLSeconds = 60
	}
	if cfg.Auth.SessionTTLSeconds <= 0 {
		cfg.Auth.SessionTTLSeconds = 43200
	}
	if cfg.Auth.LoginRateLimitWindowSeconds <= 0 {
		cfg.Auth.LoginRateLimitWindowSeconds = 60
	}
	if cfg.Auth.LoginRateLimitMaxAttempts <= 0 {
		cfg.Auth.LoginRateLimitMaxAttempts = 10
	}
	if cfg.AppAuth.JWKSCacheSeconds <= 0 {
		cfg.AppAuth.JWKSCacheSeconds = 300
	}
	if cfg.AppAuth.ClockSkewSeconds < 0 {
		cfg.AppAuth.ClockSkewSeconds = 30
	}
	if cfg.Assist.TimeoutSeconds <= 0 {
		cfg.Assist.TimeoutSeconds = 30
	}
	if cfg.Assist.MaxScreenTextChars <= 0 {
		cfg.Assist.MaxScreenTextChars = 500
	}
	if cfg.Assist.Enabled {
		if strings.TrimSpace(cfg.Assist.BaseURL) == "" {
			return fmt.Errorf("assist base-url is required when assist is enabled")
		}
		if strings.TrimSpace(cfg.Assist.APIKey) == "" {
			return fmt.Errorf("assist api-key is required when assist is enabled")
		}
		if strings.TrimSpace(cfg.Assist.Model) == "" {
			return fmt.Errorf("assist model is required when assist is enabled")
		}
	}
	return nil
}

func getenvMap(values map[string]string, key, fallback string) string {
	if raw, ok := values[key]; ok && strings.TrimSpace(raw) != "" {
		return strings.TrimSpace(raw)
	}
	return fallback
}

func getenvIntMap(values map[string]string, key string, fallback int) int {
	if raw, ok := values[key]; ok && strings.TrimSpace(raw) != "" {
		if parsed, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil {
			return parsed
		}
	}
	return fallback
}

func getenvBoolMap(values map[string]string, key string, fallback bool) bool {
	if raw, ok := values[key]; ok && strings.TrimSpace(raw) != "" {
		switch strings.ToLower(strings.TrimSpace(raw)) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return fallback
}

func getenv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func dedupeStrings(items []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		result = append(result, item)
	}
	return result
}

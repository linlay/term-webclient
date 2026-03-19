package config

import (
	"crypto/rsa"
	"crypto/x509"
	_ "embed"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed application.yml
var embeddedDefaults []byte

var envPlaceholderPattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}`)

const (
	applicationConfigRelativePath = "configs/application.yml"
	assistConfigRelativePath      = "configs/assist.yml"
	cliClientsConfigDirPath       = "configs/cli-clients"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Terminal TerminalConfig `yaml:"terminal"`
	Copilot  CopilotConfig  `yaml:"copilot"`
	Assist   AssistConfig   `yaml:"assist"`
	Auth     AuthConfig     `yaml:"auth"`
	AppAuth  AppAuthConfig  `yaml:"app-auth"`
	App      AppMetaConfig  `yaml:"app"`
}

type ServerConfig struct {
	Address string `yaml:"address" env:"BACKEND_HOST"`
	Port    int    `yaml:"port" env:"BACKEND_PORT"`
}

type TerminalConfig struct {
	DefaultCommand         string            `yaml:"default-command"`
	DefaultArgs            []string          `yaml:"default-args"`
	DefaultWorkdir         string            `yaml:"default-workdir"`
	WorkdirBrowseRoot      string            `yaml:"workdir-browse-root"`
	AllowedOrigins         []string          `yaml:"allowed-origins"`
	DetachedSessionTTL     int               `yaml:"detached-session-ttl-seconds" env:"TERMINAL_DETACHED_SESSION_TTL_SECONDS"`
	RingBufferMaxBytes     int               `yaml:"ring-buffer-max-bytes"`
	RingBufferMaxChunks    int               `yaml:"ring-buffer-max-chunks"`
	MaxCols                int               `yaml:"max-cols"`
	MaxRows                int               `yaml:"max-rows"`
	SessionEventMaxEntries int               `yaml:"session-event-max-entries"`
	CommandFrameMaxEntries int               `yaml:"command-frame-max-entries"`
	TranscriptMaxChars     int               `yaml:"transcript-max-chars"`
	RecentSessionsFile     string            `yaml:"recent-sessions-file" env:"TERMINAL_RECENT_SESSIONS_FILE"`
	RecentSessionsPerTool  int               `yaml:"recent-sessions-per-tool" env:"TERMINAL_RECENT_SESSIONS_PER_TOOL"`
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

type CopilotConfig struct {
	Runner CopilotRunnerConfig  `yaml:"runner"`
	Agents []CopilotAgentConfig `yaml:"-"`
}

type CopilotRunnerConfig struct {
	BaseURL             string `yaml:"base-url" env:"COPILOT_RUNNER_BASE_URL"`
	TimeoutSeconds      int    `yaml:"timeout-seconds" env:"COPILOT_RUNNER_TIMEOUT_SECONDS"`
	AuthorizationBearer string `yaml:"authorization-bearer" env:"COPILOT_RUNNER_AUTHORIZATION_BEARER"`
}

type CopilotAgentConfig struct {
	Key         string                 `yaml:"key"`
	Label       string                 `yaml:"label"`
	Description string                 `yaml:"description"`
	Type        string                 `yaml:"type"`
	Default     bool                   `yaml:"default"`
	Icon        CopilotAgentIconConfig `yaml:"icon"`
}

type CopilotAgentIconConfig struct {
	Name  string `yaml:"name"`
	Color string `yaml:"color"`
}

type SSHConfig struct {
	Enabled                   bool   `yaml:"enabled"`
	DefaultPort               int    `yaml:"default-port"`
	DefaultTerm               string `yaml:"default-term"`
	ConnectTimeoutMillis      int    `yaml:"connect-timeout-millis"`
	ConnectionIdleTTLSeconds  int    `yaml:"connection-idle-ttl-seconds"`
	ExecDefaultTimeoutSeconds int    `yaml:"exec-default-timeout-seconds"`
	ExecMaxOutputBytes        int    `yaml:"exec-max-output-bytes"`
	CredentialsFile           string `yaml:"credentials-file" env:"TERMINAL_SSH_CREDENTIALS_FILE"`
	KnownHostsFile            string `yaml:"known-hosts-file"`
	MasterKey                 string `yaml:"master-key" env:"TERMINAL_SSH_MASTER_KEY"`
}

type FilesConfig struct {
	Enabled                  bool     `yaml:"enabled" env:"TERMINAL_FILES_ENABLED"`
	MaxUploadFileBytes       int64    `yaml:"max-upload-file-bytes"`
	MaxUploadRequestBytes    int64    `yaml:"max-upload-request-bytes"`
	MaxDownloadArchiveBytes  int64    `yaml:"max-download-archive-bytes"`
	DefaultRootScope         string   `yaml:"default-root-scope"`
	AllowOutsideRoot         bool     `yaml:"allow-outside-root"`
	AllowedRoots             []string `yaml:"allowed-roots"`
	DownloadTicketTTLSeconds int      `yaml:"download-ticket-ttl-seconds"`
}

type AssistConfig struct {
	Enabled            bool   `yaml:"enabled" env:"ASSIST_ENABLED"`
	BaseURL            string `yaml:"base-url" env:"ASSIST_BASE_URL"`
	APIKey             string `yaml:"api-key" env:"ASSIST_API_KEY"`
	Model              string `yaml:"model" env:"ASSIST_MODEL"`
	TimeoutSeconds     int    `yaml:"timeout-seconds" env:"ASSIST_TIMEOUT_SECONDS"`
	MaxScreenTextChars int    `yaml:"max-screen-text-chars" env:"ASSIST_MAX_SCREEN_TEXT_CHARS"`
	DebugLog           bool   `yaml:"debug-log" env:"ASSIST_DEBUG_LOG"`
	SystemPrompt       string `yaml:"system-prompt" env:"ASSIST_SYSTEM_PROMPT"`
}

type AuthConfig struct {
	Enabled                     bool   `yaml:"enabled" env:"AUTH_ENABLED"`
	Username                    string `yaml:"username" env:"AUTH_USERNAME"`
	PasswordHashBcrypt          string `yaml:"password-hash-bcrypt" env:"AUTH_PASSWORD_HASH_BCRYPT"`
	SessionTTLSeconds           int    `yaml:"session-ttl-seconds" env:"AUTH_SESSION_TTL_SECONDS"`
	LoginRateLimitEnabled       bool   `yaml:"login-rate-limit-enabled" env:"AUTH_LOGIN_RATE_LIMIT_ENABLED"`
	LoginRateLimitWindowSeconds int    `yaml:"login-rate-limit-window-seconds" env:"AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS"`
	LoginRateLimitMaxAttempts   int    `yaml:"login-rate-limit-max-attempts" env:"AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS"`
}

type AppAuthConfig struct {
	Enabled            bool   `yaml:"enabled" env:"APP_AUTH_ENABLED"`
	LocalPublicKeyFile string `yaml:"local-public-key-file" env:"APP_AUTH_LOCAL_PUBLIC_KEY_FILE"`
	JWKSURI            string `yaml:"jwks-uri" env:"APP_AUTH_JWKS_URI"`
	Issuer             string `yaml:"issuer" env:"APP_AUTH_ISSUER"`
	JWKSCacheSeconds   int    `yaml:"jwks-cache-seconds" env:"APP_AUTH_JWKS_CACHE_SECONDS"`
	Audience           string `yaml:"audience" env:"APP_AUTH_AUDIENCE"`
	ClockSkewSeconds   int    `yaml:"clock-skew-seconds" env:"APP_AUTH_CLOCK_SKEW_SECONDS"`
}

type AppMetaConfig struct {
	Name      string `yaml:"name"`
	Version   string `yaml:"version"`
	GitSHA    string `yaml:"git-sha" env:"APP_GIT_SHA"`
	BuildTime string `yaml:"build-time" env:"APP_BUILD_TIME"`
}

func defaultConfig() *Config {
	home, _ := os.UserHomeDir()
	return &Config{
		Server: ServerConfig{
			Address: "127.0.0.1",
			Port:    8080,
		},
		Terminal: TerminalConfig{
			DefaultCommand:         "zsh",
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
			CliClients:             []CLIClientConfig{},
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
		Copilot: CopilotConfig{
			Runner: CopilotRunnerConfig{
				TimeoutSeconds: 60,
			},
			Agents: []CopilotAgentConfig{defaultBuiltinCopilotAgent()},
		},
		Assist: AssistConfig{
			Enabled:            false,
			BaseURL:            "https://dashscope.aliyuncs.com/compatible-mode/v1",
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
	processEnv := envToMap(os.Environ())

	overrides, envBaseDir, err := loadEnvFiles()
	if err != nil {
		return nil, err
	}
	effectiveValues := map[string]string{}
	for key, value := range overrides {
		effectiveValues[key] = value
	}
	for key, value := range processEnv {
		effectiveValues[key] = value
	}

	if err := mergeYAMLBytes(cfg, embeddedDefaults, effectiveValues, "embedded application.yml"); err != nil {
		return nil, err
	}
	runtimeApplicationConfigPath := resolveRuntimeConfigPath(applicationConfigRelativePath, envBaseDir)
	configPath := strings.TrimSpace(effectiveValues["CONFIG_PATH"])
	if configPath != "" && sameConfigFile(runtimeApplicationConfigPath, configPath) {
		if err := mergeMainConfigFile(cfg, configPath, effectiveValues, true); err != nil {
			return nil, err
		}
	} else {
		if err := mergeMainConfigFile(cfg, runtimeApplicationConfigPath, effectiveValues, false); err != nil {
			return nil, err
		}
		if configPath != "" {
			if err := mergeMainConfigFile(cfg, configPath, effectiveValues, true); err != nil {
				return nil, err
			}
		}
	}
	if err := loadAssistConfig(cfg, envBaseDir, effectiveValues); err != nil {
		return nil, err
	}
	if err := loadCLIClients(cfg, envBaseDir, effectiveValues); err != nil {
		return nil, err
	}

	applyEnvMapFromTags(cfg, overrides)
	applyEnvMapFromTags(cfg, processEnv)
	if err := loadCopilotAgents(cfg, envBaseDir, effectiveValues); err != nil {
		return nil, err
	}

	if err := validate(cfg, envBaseDir); err != nil {
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
	payload, ok, err := readConfigFile(filePath, required)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	return mergeYAMLBytes(cfg, payload, placeholderValues, filePath)
}

func mergeMainConfigFile(cfg *Config, filePath string, placeholderValues map[string]string, required bool) error {
	payload, ok, err := readConfigFile(filePath, required)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	if err := validateLegacyStructuredConfigKeys(payload, filePath); err != nil {
		return err
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

func loadAssistConfig(cfg *Config, envBaseDir string, placeholderValues map[string]string) error {
	filePath := resolveRuntimeConfigPath(assistConfigRelativePath, envBaseDir)
	payload, ok, err := readConfigFile(filePath, false)
	if err != nil {
		return err
	}
	if !ok || len(strings.TrimSpace(string(payload))) == 0 {
		return nil
	}
	if err := validateAssistFileShape(payload, filePath); err != nil {
		return err
	}
	payload = []byte(expandEnvPlaceholders(string(payload), placeholderValues))
	if err := yaml.Unmarshal(payload, &cfg.Assist); err != nil {
		return fmt.Errorf("parse %s: %w", filePath, err)
	}
	return nil
}

func readConfigFile(filePath string, required bool) ([]byte, bool, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			if required {
				return nil, false, fmt.Errorf("required config file not found: %s", filePath)
			}
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("stat %s: %w", filePath, err)
	}
	if info.IsDir() {
		if required {
			return nil, false, fmt.Errorf("required config path is a directory: %s", filePath)
		}
		return nil, false, nil
	}
	payload, err := os.ReadFile(filePath)
	if err != nil {
		return nil, false, fmt.Errorf("read %s: %w", filePath, err)
	}
	return payload, true, nil
}

func loadEnvFiles() (map[string]string, string, error) {
	result := map[string]string{}
	envBaseDir := ""
	for _, filePath := range envCandidates() {
		info, err := os.Stat(filePath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, "", fmt.Errorf("stat %s: %w", filePath, err)
		}
		if info.IsDir() {
			continue
		}
		values, err := parseEnvFile(filePath)
		if err != nil {
			return nil, "", err
		}
		for k, v := range values {
			result[k] = v
		}
		envBaseDir = filepath.Dir(filePath)
	}
	return result, envBaseDir, nil
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

func applyEnvMapFromTags(cfg *Config, values map[string]string) {
	if len(values) == 0 {
		return
	}
	applyEnvValues(reflect.ValueOf(cfg), values)
}

func validate(cfg *Config, envBaseDir string) error {
	if strings.TrimSpace(cfg.Server.Address) == "" {
		return fmt.Errorf("backend host must not be blank")
	}
	if cfg.Server.Port <= 0 || cfg.Server.Port > 65535 {
		return fmt.Errorf("invalid backend port: %d", cfg.Server.Port)
	}
	if strings.TrimSpace(cfg.Terminal.WorkdirBrowseRoot) == "" {
		return fmt.Errorf("terminal workdir-browse-root must not be blank")
	}
	if cfg.Terminal.MaxCols <= 0 || cfg.Terminal.MaxRows <= 0 {
		return fmt.Errorf("terminal max rows and cols must be positive")
	}
	if cfg.Terminal.DetachedSessionTTL <= 0 || cfg.Terminal.RingBufferMaxBytes <= 0 || cfg.Terminal.RingBufferMaxChunks <= 0 {
		return fmt.Errorf("terminal buffer and ttl settings must be positive")
	}
	if cfg.Terminal.SessionEventMaxEntries <= 0 || cfg.Terminal.CommandFrameMaxEntries <= 0 || cfg.Terminal.TranscriptMaxChars <= 0 {
		return fmt.Errorf("terminal context and transcript limits must be positive")
	}
	if cfg.Terminal.RecentSessionsPerTool <= 0 {
		return fmt.Errorf("terminal recent sessions per tool must be positive")
	}
	if cfg.Terminal.Agent.StepTimeoutSeconds <= 0 || cfg.Terminal.Agent.MaxStepResultChars <= 0 || cfg.Terminal.Agent.MaxContextPackBytes <= 0 {
		return fmt.Errorf("terminal agent limits must be positive")
	}
	if cfg.Copilot.Runner.TimeoutSeconds <= 0 {
		return fmt.Errorf("copilot runner timeout must be positive")
	}
	if cfg.Terminal.SSH.DefaultPort <= 0 || strings.TrimSpace(cfg.Terminal.SSH.DefaultTerm) == "" {
		return fmt.Errorf("ssh defaults must be configured")
	}
	if cfg.Terminal.SSH.ConnectTimeoutMillis <= 0 || cfg.Terminal.SSH.ExecDefaultTimeoutSeconds <= 0 || cfg.Terminal.SSH.ExecMaxOutputBytes <= 0 {
		return fmt.Errorf("ssh timeouts and limits must be positive")
	}
	if cfg.Terminal.Files.DownloadTicketTTLSeconds <= 0 {
		return fmt.Errorf("file download ticket ttl must be positive")
	}
	if cfg.Auth.SessionTTLSeconds <= 0 {
		return fmt.Errorf("auth session ttl must be positive")
	}
	cfg.Auth.PasswordHashBcrypt = trimEnvQuotes(cfg.Auth.PasswordHashBcrypt)
	if cfg.Auth.LoginRateLimitWindowSeconds <= 0 || cfg.Auth.LoginRateLimitMaxAttempts <= 0 {
		return fmt.Errorf("auth login rate limit settings must be positive")
	}
	if strings.TrimSpace(cfg.AppAuth.LocalPublicKeyFile) != "" {
		if resolvedPath, err := resolveLocalPublicKeyFile(cfg.AppAuth.LocalPublicKeyFile, envBaseDir); err != nil {
			if cfg.AppAuth.Enabled {
				return err
			}
		} else {
			cfg.AppAuth.LocalPublicKeyFile = resolvedPath
		}
	}
	if cfg.AppAuth.JWKSCacheSeconds <= 0 {
		return fmt.Errorf("app auth jwks cache seconds must be positive")
	}
	if cfg.AppAuth.ClockSkewSeconds < 0 {
		return fmt.Errorf("app auth clock skew seconds must be zero or positive")
	}
	if cfg.Assist.TimeoutSeconds <= 0 || cfg.Assist.MaxScreenTextChars <= 0 {
		return fmt.Errorf("assist timeout and screen text limits must be positive")
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
	if err := validateCopilot(cfg); err != nil {
		return err
	}
	return nil
}

func applyEnvValues(target reflect.Value, values map[string]string) {
	if !target.IsValid() {
		return
	}
	if target.Kind() == reflect.Pointer {
		if target.IsNil() {
			return
		}
		target = target.Elem()
	}
	if target.Kind() != reflect.Struct {
		return
	}
	targetType := target.Type()
	for index := 0; index < target.NumField(); index++ {
		fieldValue := target.Field(index)
		fieldType := targetType.Field(index)
		if !fieldValue.CanSet() {
			continue
		}
		if envKey := strings.TrimSpace(fieldType.Tag.Get("env")); envKey != "" {
			applyTaggedEnvValue(fieldValue, envKey, values)
		}
		switch fieldValue.Kind() {
		case reflect.Pointer:
			if !fieldValue.IsNil() {
				applyEnvValues(fieldValue, values)
			}
		case reflect.Struct:
			applyEnvValues(fieldValue.Addr(), values)
		}
	}
}

func validateLegacyStructuredConfigKeys(payload []byte, source string) error {
	var raw map[string]any
	if err := yaml.Unmarshal(payload, &raw); err != nil {
		return nil
	}
	if len(raw) == 0 {
		return nil
	}
	if _, ok := raw["assist"]; ok {
		return fmt.Errorf("%s uses removed top-level assist; move assist config to %s with a flat structure", source, assistConfigRelativePath)
	}
	terminalValue, ok := raw["terminal"]
	if !ok {
		return nil
	}
	terminalMap, ok := terminalValue.(map[string]any)
	if !ok {
		return nil
	}
	if _, ok := terminalMap["cli-clients"]; ok {
		return fmt.Errorf("%s uses removed terminal.cli-clients; move CLI clients to %s/*.yml", source, cliClientsConfigDirPath)
	}
	return nil
}

func validateAssistFileShape(payload []byte, source string) error {
	var raw map[string]any
	if err := yaml.Unmarshal(payload, &raw); err != nil {
		return nil
	}
	if len(raw) == 0 {
		return nil
	}
	if _, ok := raw["assist"]; ok {
		return fmt.Errorf("%s must not contain top-level assist; define assist fields directly", source)
	}
	return nil
}

func applyTaggedEnvValue(target reflect.Value, envKey string, values map[string]string) {
	raw, ok := values[envKey]
	if !ok || strings.TrimSpace(raw) == "" {
		return
	}
	switch target.Kind() {
	case reflect.String:
		target.SetString(strings.TrimSpace(raw))
	case reflect.Bool:
		switch strings.ToLower(strings.TrimSpace(raw)) {
		case "1", "true", "yes", "on":
			target.SetBool(true)
		case "0", "false", "no", "off":
			target.SetBool(false)
		}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
		if err == nil {
			target.SetInt(parsed)
		}
	}
}

func validateCopilot(cfg *Config) error {
	if len(cfg.Copilot.Agents) == 0 {
		return fmt.Errorf("copilot agents must not be empty")
	}

	seenKeys := map[string]struct{}{}
	defaultCount := 0
	hasRunnerAgent := false
	for index := range cfg.Copilot.Agents {
		agent := &cfg.Copilot.Agents[index]
		agent.Key = strings.TrimSpace(agent.Key)
		agent.Label = strings.TrimSpace(agent.Label)
		agent.Description = strings.TrimSpace(agent.Description)
		agent.Type = strings.TrimSpace(agent.Type)
		agent.Icon.Name = strings.TrimSpace(agent.Icon.Name)
		agent.Icon.Color = strings.TrimSpace(agent.Icon.Color)

		if agent.Key == "" {
			return fmt.Errorf("copilot agent key is required")
		}
		if _, ok := seenKeys[agent.Key]; ok {
			return fmt.Errorf("copilot agent key must be unique: %s", agent.Key)
		}
		seenKeys[agent.Key] = struct{}{}
		if agent.Label == "" {
			agent.Label = agent.Key
		}
		switch agent.Type {
		case "builtin_assist":
		case "runner_agent":
			hasRunnerAgent = true
		default:
			return fmt.Errorf("copilot agent %s has unsupported type: %s", agent.Key, agent.Type)
		}
		if agent.Default {
			defaultCount++
		}
	}
	if defaultCount != 1 {
		return fmt.Errorf("copilot requires exactly one default agent")
	}
	if hasRunnerAgent && strings.TrimSpace(cfg.Copilot.Runner.BaseURL) == "" {
		return fmt.Errorf("copilot runner base-url is required when runner_agent is configured")
	}
	return nil
}

func resolveLocalPublicKeyFile(rawPath, envBaseDir string) (string, error) {
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		return "", nil
	}
	resolved := trimmed
	if !filepath.IsAbs(resolved) {
		baseDir := strings.TrimSpace(envBaseDir)
		if baseDir == "" {
			cwd, _ := os.Getwd()
			baseDir = cwd
		}
		resolved = filepath.Join(baseDir, resolved)
	}
	resolved = filepath.Clean(resolved)
	payload, err := os.ReadFile(resolved)
	if err != nil {
		return "", fmt.Errorf("read app auth local public key file %s: %w", resolved, err)
	}
	if _, err := parseRSAPublicKeyPEM(payload); err != nil {
		return "", fmt.Errorf("parse app auth local public key file %s: %w", resolved, err)
	}
	return resolved, nil
}

func parseRSAPublicKeyPEM(payload []byte) (*rsa.PublicKey, error) {
	block, _ := pem.Decode(payload)
	if block == nil {
		return nil, errors.New("pem decode failed")
	}
	key, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("rsa parse failed: %w", err)
	}
	rsaKey, ok := key.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("rsa parse failed")
	}
	return rsaKey, nil
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

func sameConfigFile(left, right string) bool {
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	if left == "" || right == "" {
		return false
	}

	leftComparable, err := comparableConfigPath(left)
	if err != nil {
		return false
	}
	rightComparable, err := comparableConfigPath(right)
	if err != nil {
		return false
	}
	return leftComparable == rightComparable
}

func comparableConfigPath(filePath string) (string, error) {
	if filepath.IsAbs(filePath) {
		return filepath.Clean(filePath), nil
	}
	absolutePath, err := filepath.Abs(filePath)
	if err != nil {
		return "", err
	}
	return filepath.Clean(absolutePath), nil
}

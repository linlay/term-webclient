package config

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadUsesEmbeddedDefaultsWithoutExternalConfig(t *testing.T) {
	repoRoot := t.TempDir()
	backendDir := filepath.Join(repoRoot, "backend")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte("BACKEND_PORT=11937\n"), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}

	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})
	if err := os.Chdir(backendDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.Server.Port != 11937 {
		t.Fatalf("expected env override port 11937, got %d", cfg.Server.Port)
	}
	if cfg.Terminal.DefaultCommand != "zsh" {
		t.Fatalf("expected embedded default command zsh, got %q", cfg.Terminal.DefaultCommand)
	}
	if len(cfg.Terminal.CliClients) != 0 {
		t.Fatalf("expected embedded cli clients to be empty, got %d", len(cfg.Terminal.CliClients))
	}
	if len(cfg.Copilot.Agents) != 1 || cfg.Copilot.Agents[0].Key != "default-assist" || !cfg.Copilot.Agents[0].Default {
		t.Fatalf("expected builtin copilot assist as only default agent, got %#v", cfg.Copilot.Agents)
	}
}

func TestLoadAppliesRuntimeApplicationConfigWithoutConfigPath(t *testing.T) {
	repoRoot := t.TempDir()
	backendDir := filepath.Join(repoRoot, "backend")
	configsDir := filepath.Join(repoRoot, "configs")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.MkdirAll(configsDir, 0o755); err != nil {
		t.Fatalf("mkdir configs dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte("BACKEND_PORT=11937\n"), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}
	runtimeConfig := "" +
		"server:\n  port: 22000\n" +
		"terminal:\n" +
		"  recent-sessions-per-tool: 9\n" +
		"  cli-clients:\n" +
		"    - id: codex\n" +
		"      label: Codex\n" +
		"      command: codex\n" +
		"      args: []\n" +
		"      workdir: .\n" +
		"      env:\n" +
		"        https_proxy: http://127.0.0.1:8001\n" +
		"      shell: /bin/zsh\n"
	if err := os.WriteFile(filepath.Join(configsDir, "application.yml"), []byte(runtimeConfig), 0o644); err != nil {
		t.Fatalf("write runtime config: %v", err)
	}

	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})
	if err := os.Chdir(backendDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.Server.Port != 11937 {
		t.Fatalf("expected env override port 11937, got %d", cfg.Server.Port)
	}
	if cfg.Terminal.RecentSessionsPerTool != 9 {
		t.Fatalf("expected runtime application config to override recent sessions, got %d", cfg.Terminal.RecentSessionsPerTool)
	}
	if len(cfg.Terminal.CliClients) != 1 {
		t.Fatalf("expected runtime application config cli clients, got %d", len(cfg.Terminal.CliClients))
	}
	if cfg.Terminal.CliClients[0].Env["https_proxy"] != "http://127.0.0.1:8001" {
		t.Fatalf("expected runtime application config cli env override, got %#v", cfg.Terminal.CliClients[0].Env)
	}
}

func TestLoadAppliesConfigPathAndEnvOverride(t *testing.T) {
	repoRoot := t.TempDir()
	backendDir := filepath.Join(repoRoot, "backend")
	configsDir := filepath.Join(repoRoot, "configs")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.MkdirAll(configsDir, 0o755); err != nil {
		t.Fatalf("mkdir configs dir: %v", err)
	}
	envContent := "" +
		"CONFIG_PATH=../configs/config.dev.yml\n" +
		"BACKEND_PORT=11937\n" +
		"TERMINAL_FILES_ENABLED=true\n" +
		"COPILOT_RUNNER_BASE_URL=https://runner.example\n" +
		"COPILOT_RUNNER_TIMEOUT_SECONDS=75\n" +
		"COPILOT_RUNNER_AUTHORIZATION_BEARER=test-runner-token\n" +
		"AUTH_ENABLED=true\n" +
		"AUTH_USERNAME=tester\n" +
		"AUTH_PASSWORD_HASH_BCRYPT=$2a$10$abcdefghijklmnopqrstuu4r0JZs6KQ4QvOB0fOkH1ZZ1xd6QbaO\n" +
		"APP_AUTH_ENABLED=true\n" +
		"APP_AUTH_LOCAL_PUBLIC_KEY_FILE=./configs/local-public-key.pem\n" +
		"APP_AUTH_JWKS_URI=https://issuer.example/.well-known/jwks.json\n" +
		"APP_AUTH_ISSUER=https://issuer.example\n" +
		"APP_AUTH_AUDIENCE=appterm\n" +
		"ASSIST_ENABLED=true\n" +
		"ASSIST_API_KEY=test-assist-key\n" +
		"ASSIST_SYSTEM_PROMPT=Return JSON only.\n"
	if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte(envContent), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}
	runtimeConfigContent := "" +
		"terminal:\n  recent-sessions-per-tool: 7\n"
	if err := os.WriteFile(filepath.Join(configsDir, "application.yml"), []byte(runtimeConfigContent), 0o644); err != nil {
		t.Fatalf("write runtime application config: %v", err)
	}
	configPathContent := "" +
		"server:\n  port: 22000\n" +
		"terminal:\n  recent-sessions-per-tool: 9\n"
	if err := os.WriteFile(filepath.Join(configsDir, "config.dev.yml"), []byte(configPathContent), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	assistContent := "" +
		"assist:\n" +
		"  enabled: true\n" +
		"  base-url: https://dashscope.aliyuncs.com/compatible-mode/v1\n" +
		"  api-key: ${ASSIST_API_KEY:}\n" +
		"  model: qwen-plus\n" +
		"  timeout-seconds: 45\n" +
		"  max-screen-text-chars: 900\n" +
		"  debug-log: true\n"
	if err := os.WriteFile(filepath.Join(configsDir, "assist.yml"), []byte(assistContent), 0o644); err != nil {
		t.Fatalf("write assist config: %v", err)
	}
	agentsContent := "" +
		"agents:\n" +
		"  - key: terminal-assistant\n" +
		"    label: Terminal Assistant\n" +
		"    description: Runner-backed assistant\n" +
		"    default: true\n" +
		"    icon:\n" +
		"      name: wrench\n" +
		"      color: \"#0F766E\"\n"
	if err := os.WriteFile(filepath.Join(configsDir, "agents.yml"), []byte(agentsContent), 0o644); err != nil {
		t.Fatalf("write agents config: %v", err)
	}
	writeTestPublicKeyFile(t, filepath.Join(configsDir, "local-public-key.pem"))

	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})
	if err := os.Chdir(backendDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.Server.Port != 11937 {
		t.Fatalf("expected env override port 11937, got %d", cfg.Server.Port)
	}
	if cfg.Terminal.RecentSessionsPerTool != 9 {
		t.Fatalf("expected CONFIG_PATH override for recent sessions, got %d", cfg.Terminal.RecentSessionsPerTool)
	}
	if !cfg.Terminal.Files.Enabled {
		t.Fatal("expected env override to enable files")
	}
	if cfg.Copilot.Runner.BaseURL != "https://runner.example" {
		t.Fatalf("expected copilot runner base url env override, got %q", cfg.Copilot.Runner.BaseURL)
	}
	if cfg.Copilot.Runner.TimeoutSeconds != 75 {
		t.Fatalf("expected copilot runner timeout env override, got %d", cfg.Copilot.Runner.TimeoutSeconds)
	}
	if cfg.Copilot.Runner.AuthorizationBearer != "test-runner-token" {
		t.Fatalf("expected copilot runner bearer env override, got %q", cfg.Copilot.Runner.AuthorizationBearer)
	}
	if len(cfg.Copilot.Agents) != 2 {
		t.Fatalf("expected builtin + agents.yml copilot agents, got %d", len(cfg.Copilot.Agents))
	}
	if cfg.Copilot.Agents[0].Default {
		t.Fatalf("expected builtin assist default to yield to runner default, got %#v", cfg.Copilot.Agents)
	}
	if cfg.Copilot.Agents[1].Key != "terminal-assistant" || !cfg.Copilot.Agents[1].Default {
		t.Fatalf("expected runner agent from agents.yml to become default, got %#v", cfg.Copilot.Agents[1])
	}
	if !cfg.Auth.Enabled || cfg.Auth.Username != "tester" {
		t.Fatalf("expected auth env override, got enabled=%v username=%q", cfg.Auth.Enabled, cfg.Auth.Username)
	}
	if cfg.Auth.PasswordHashBcrypt == "" {
		t.Fatal("expected auth bcrypt hash to load from env")
	}
	if !cfg.AppAuth.Enabled {
		t.Fatal("expected app auth env override to enable auth")
	}
	expectedKeyPath := mustEvalPath(t, filepath.Join(configsDir, "local-public-key.pem"))
	if cfg.AppAuth.LocalPublicKeyFile != expectedKeyPath {
		t.Fatalf("expected local public key file %q, got %q", expectedKeyPath, cfg.AppAuth.LocalPublicKeyFile)
	}
	if cfg.AppAuth.JWKSURI != "https://issuer.example/.well-known/jwks.json" {
		t.Fatalf("expected jwks uri env override, got %q", cfg.AppAuth.JWKSURI)
	}
	if cfg.AppAuth.Issuer != "https://issuer.example" || cfg.AppAuth.Audience != "appterm" {
		t.Fatalf("expected issuer/audience env override, got issuer=%q audience=%q", cfg.AppAuth.Issuer, cfg.AppAuth.Audience)
	}
	if !cfg.Assist.Enabled {
		t.Fatal("expected assist env override to enable assist")
	}
	if cfg.Assist.BaseURL != "https://dashscope.aliyuncs.com/compatible-mode/v1" {
		t.Fatalf("expected assist base url env override, got %q", cfg.Assist.BaseURL)
	}
	if cfg.Assist.APIKey != "test-assist-key" || cfg.Assist.Model != "qwen-plus" {
		t.Fatalf("expected assist credentials/model env override, got apiKey=%q model=%q", cfg.Assist.APIKey, cfg.Assist.Model)
	}
	if cfg.Assist.TimeoutSeconds != 45 || cfg.Assist.MaxScreenTextChars != 900 {
		t.Fatalf("expected assist numeric env override, got timeout=%d maxChars=%d", cfg.Assist.TimeoutSeconds, cfg.Assist.MaxScreenTextChars)
	}
	if !cfg.Assist.DebugLog {
		t.Fatal("expected assist debug log env override")
	}
	if cfg.Assist.SystemPrompt != "Return JSON only." {
		t.Fatalf("expected assist system prompt env override, got %q", cfg.Assist.SystemPrompt)
	}
}

func TestLoadFailsWhenRuntimeApplicationConfigInvalid(t *testing.T) {
	repoRoot := t.TempDir()
	backendDir := filepath.Join(repoRoot, "backend")
	configsDir := filepath.Join(repoRoot, "configs")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.MkdirAll(configsDir, 0o755); err != nil {
		t.Fatalf("mkdir configs dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte("BACKEND_PORT=11937\n"), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configsDir, "application.yml"), []byte("terminal:\n\tcli-clients: true\n"), 0o644); err != nil {
		t.Fatalf("write invalid runtime config: %v", err)
	}

	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})
	if err := os.Chdir(backendDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "parse") {
		t.Fatalf("expected parse error for invalid runtime application config, got %v", err)
	}
}

func TestLoadFailsWhenConfigPathMissing(t *testing.T) {
	repoRoot := t.TempDir()
	backendDir := filepath.Join(repoRoot, "backend")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte("CONFIG_PATH=../configs/missing.yml\n"), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}

	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})
	if err := os.Chdir(backendDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	if _, err := Load(); err == nil {
		t.Fatal("expected missing CONFIG_PATH file to fail")
	}
}

func TestLoadSupportsQuotedBcryptHashFromProcessEnv(t *testing.T) {
	testCases := []struct {
		name   string
		value  string
		expect string
	}{
		{
			name:   "single quoted",
			value:  "'$2a$10$abcdefghijklmnopqrstuu4r0JZs6KQ4QvOB0fOkH1ZZ1xd6QbaO'",
			expect: "$2a$10$abcdefghijklmnopqrstuu4r0JZs6KQ4QvOB0fOkH1ZZ1xd6QbaO",
		},
		{
			name:   "double quoted",
			value:  "\"$2a$10$abcdefghijklmnopqrstuu4r0JZs6KQ4QvOB0fOkH1ZZ1xd6QbaO\"",
			expect: "$2a$10$abcdefghijklmnopqrstuu4r0JZs6KQ4QvOB0fOkH1ZZ1xd6QbaO",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			repoRoot := t.TempDir()
			backendDir := filepath.Join(repoRoot, "backend")
			if err := os.MkdirAll(backendDir, 0o755); err != nil {
				t.Fatalf("mkdir backend dir: %v", err)
			}

			t.Setenv("CONFIG_PATH", "")
			t.Setenv("AUTH_PASSWORD_HASH_BCRYPT", tc.value)

			previousWD, err := os.Getwd()
			if err != nil {
				t.Fatalf("getwd: %v", err)
			}
			t.Cleanup(func() {
				_ = os.Chdir(previousWD)
			})
			if err := os.Chdir(backendDir); err != nil {
				t.Fatalf("chdir: %v", err)
			}

			cfg, err := Load()
			if err != nil {
				t.Fatalf("load config: %v", err)
			}
			if cfg.Auth.PasswordHashBcrypt != tc.expect {
				t.Fatalf("expected bcrypt hash %q, got %q", tc.expect, cfg.Auth.PasswordHashBcrypt)
			}
		})
	}
}

func TestLoadResolvesLocalPublicKeyFileRelativeToEnv(t *testing.T) {
	repoRoot := t.TempDir()
	backendDir := filepath.Join(repoRoot, "backend")
	configsDir := filepath.Join(repoRoot, "configs")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.MkdirAll(configsDir, 0o755); err != nil {
		t.Fatalf("mkdir configs dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte("APP_AUTH_ENABLED=true\nAPP_AUTH_LOCAL_PUBLIC_KEY_FILE=./configs/local-public-key.pem\n"), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}
	writeTestPublicKeyFile(t, filepath.Join(configsDir, "local-public-key.pem"))

	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})
	if err := os.Chdir(backendDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	expected := mustEvalPath(t, filepath.Join(configsDir, "local-public-key.pem"))
	if cfg.AppAuth.LocalPublicKeyFile != expected {
		t.Fatalf("expected resolved local public key file %q, got %q", expected, cfg.AppAuth.LocalPublicKeyFile)
	}
}

func TestLoadFailsWhenLocalPublicKeyFileMissing(t *testing.T) {
	repoRoot := t.TempDir()
	backendDir := filepath.Join(repoRoot, "backend")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte("APP_AUTH_ENABLED=true\nAPP_AUTH_LOCAL_PUBLIC_KEY_FILE=./configs/local-public-key.pem\n"), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}

	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})
	if err := os.Chdir(backendDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "read app auth local public key file") {
		t.Fatalf("expected missing local public key file error, got %v", err)
	}
}

func TestLoadFailsWhenLocalPublicKeyFileInvalid(t *testing.T) {
	repoRoot := t.TempDir()
	backendDir := filepath.Join(repoRoot, "backend")
	configsDir := filepath.Join(repoRoot, "configs")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.MkdirAll(configsDir, 0o755); err != nil {
		t.Fatalf("mkdir configs dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte("APP_AUTH_ENABLED=true\nAPP_AUTH_LOCAL_PUBLIC_KEY_FILE=./configs/local-public-key.pem\n"), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configsDir, "local-public-key.pem"), []byte("not-a-pem"), 0o644); err != nil {
		t.Fatalf("write invalid key: %v", err)
	}

	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})
	if err := os.Chdir(backendDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "parse app auth local public key file") {
		t.Fatalf("expected invalid local public key file error, got %v", err)
	}
}

func TestLoadFailsWhenAssistEnabledWithoutRequiredFields(t *testing.T) {
	testCases := []struct {
		name       string
		envContent string
		assistYAML string
		wantErr    string
	}{
		{
			name: "missing base url",
			envContent: "" +
				"ASSIST_ENABLED=true\n" +
				"ASSIST_API_KEY=test-assist-key\n" +
				"ASSIST_MODEL=qwen-plus\n",
			assistYAML: "assist:\n  enabled: true\n  base-url: \"\"\n  api-key: ${ASSIST_API_KEY:}\n  model: ${ASSIST_MODEL:}\n",
			wantErr:    "assist base-url is required when assist is enabled",
		},
		{
			name:       "missing api key",
			envContent: "",
			assistYAML: "" +
				"assist:\n" +
				"  enabled: true\n" +
				"  base-url: https://dashscope.aliyuncs.com/compatible-mode/v1\n" +
				"  model: qwen-plus\n",
			wantErr: "assist api-key is required when assist is enabled",
		},
		{
			name: "missing model",
			envContent: "" +
				"ASSIST_API_KEY=test-assist-key\n",
			assistYAML: "" +
				"assist:\n" +
				"  enabled: true\n" +
				"  base-url: https://dashscope.aliyuncs.com/compatible-mode/v1\n" +
				"  api-key: ${ASSIST_API_KEY:}\n",
			wantErr: "assist model is required when assist is enabled",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			repoRoot := t.TempDir()
			backendDir := filepath.Join(repoRoot, "backend")
			configsDir := filepath.Join(repoRoot, "configs")
			if err := os.MkdirAll(backendDir, 0o755); err != nil {
				t.Fatalf("mkdir backend dir: %v", err)
			}
			if tc.assistYAML != "" {
				if err := os.MkdirAll(configsDir, 0o755); err != nil {
					t.Fatalf("mkdir configs dir: %v", err)
				}
				if err := os.WriteFile(filepath.Join(configsDir, "assist.yml"), []byte(tc.assistYAML), 0o644); err != nil {
					t.Fatalf("write assist config: %v", err)
				}
			}
			if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte(tc.envContent), 0o644); err != nil {
				t.Fatalf("write env: %v", err)
			}

			previousWD, err := os.Getwd()
			if err != nil {
				t.Fatalf("getwd: %v", err)
			}
			t.Cleanup(func() {
				_ = os.Chdir(previousWD)
			})
			if err := os.Chdir(backendDir); err != nil {
				t.Fatalf("chdir: %v", err)
			}

			if _, err := Load(); err == nil || err.Error() != tc.wantErr {
				t.Fatalf("expected error %q, got %v", tc.wantErr, err)
			}
		})
	}
}

func TestLoadFailsWhenCopilotRunnerAgentHasInvalidConfiguration(t *testing.T) {
	testCases := []struct {
		name       string
		envContent string
		agentsYAML string
		wantErr    string
	}{
		{
			name: "runner agent missing base url",
			agentsYAML: "" +
				"agents:\n" +
				"  - key: terminal-assistant\n" +
				"    label: Terminal Assistant\n",
			wantErr: "copilot runner base-url is required when runner_agent is configured",
		},
		{
			name:       "runner agent missing label",
			envContent: "COPILOT_RUNNER_BASE_URL=https://runner.example\n",
			agentsYAML: "" +
				"agents:\n" +
				"  - key: terminal-assistant\n",
			wantErr: "copilot runner agent terminal-assistant requires label",
		},
		{
			name:       "multiple defaults",
			envContent: "COPILOT_RUNNER_BASE_URL=https://runner.example\n",
			agentsYAML: "" +
				"agents:\n" +
				"  - key: terminal-assistant\n" +
				"    label: Terminal Assistant\n" +
				"    default: true\n" +
				"  - key: repo-helper\n" +
				"    label: Repo Helper\n" +
				"    default: true\n",
			wantErr: "copilot runner agents require at most one default agent",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			repoRoot := t.TempDir()
			backendDir := filepath.Join(repoRoot, "backend")
			configsDir := filepath.Join(repoRoot, "configs")
			if err := os.MkdirAll(backendDir, 0o755); err != nil {
				t.Fatalf("mkdir backend dir: %v", err)
			}
			if err := os.MkdirAll(configsDir, 0o755); err != nil {
				t.Fatalf("mkdir configs dir: %v", err)
			}
			if err := os.WriteFile(filepath.Join(configsDir, "agents.yml"), []byte(tc.agentsYAML), 0o644); err != nil {
				t.Fatalf("write agents config: %v", err)
			}
			if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte(tc.envContent), 0o644); err != nil {
				t.Fatalf("write env: %v", err)
			}

			previousWD, err := os.Getwd()
			if err != nil {
				t.Fatalf("getwd: %v", err)
			}
			t.Cleanup(func() {
				_ = os.Chdir(previousWD)
			})
			if err := os.Chdir(backendDir); err != nil {
				t.Fatalf("chdir: %v", err)
			}

			_, err = Load()
			if err == nil {
				t.Fatalf("expected error %q, got nil", tc.wantErr)
			}
			if tc.name == "runner agent missing label" {
				if !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("expected error containing %q, got %v", tc.wantErr, err)
				}
				return
			}
			if err.Error() != tc.wantErr {
				t.Fatalf("expected error %q, got %v", tc.wantErr, err)
			}
		})
	}
}

func TestLoadFailsWhenCopilotAgentsFileIsInvalid(t *testing.T) {
	repoRoot := t.TempDir()
	backendDir := filepath.Join(repoRoot, "backend")
	configsDir := filepath.Join(repoRoot, "configs")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.MkdirAll(configsDir, 0o755); err != nil {
		t.Fatalf("mkdir configs dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configsDir, "agents.yml"), []byte("agents:\n  - key: terminal-assistant\n    label: [\n"), 0o644); err != nil {
		t.Fatalf("write invalid agents config: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte("COPILOT_RUNNER_BASE_URL=https://runner.example\n"), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}

	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})
	if err := os.Chdir(backendDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "parse") {
		t.Fatalf("expected parse error for invalid agents.yml, got %v", err)
	}
}

func TestLoadFailsWhenLegacyCopilotAgentsConfiguredInConfigPath(t *testing.T) {
	repoRoot := t.TempDir()
	backendDir := filepath.Join(repoRoot, "backend")
	configsDir := filepath.Join(repoRoot, "configs")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.MkdirAll(configsDir, 0o755); err != nil {
		t.Fatalf("mkdir configs dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configsDir, "config.dev.yml"), []byte("copilot:\n  agents:\n    - key: terminal-assistant\n"), 0o644); err != nil {
		t.Fatalf("write legacy config: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte("CONFIG_PATH=../configs/config.dev.yml\n"), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}

	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})
	if err := os.Chdir(backendDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "uses removed copilot.agents") {
		t.Fatalf("expected legacy copilot.agents error, got %v", err)
	}
}

func writeTestPublicKeyFile(t *testing.T, path string) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	encoded, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		t.Fatalf("marshal public key: %v", err)
	}
	block := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: encoded})
	if err := os.WriteFile(path, block, 0o644); err != nil {
		t.Fatalf("write public key file: %v", err)
	}
}

func mustEvalPath(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatalf("eval symlinks for %s: %v", path, err)
	}
	return resolved
}

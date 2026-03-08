package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadUsesEmbeddedDefaultsWithoutExternalConfig(t *testing.T) {
	repoRoot := t.TempDir()
	backendDir := filepath.Join(repoRoot, "backend")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte("BACKEND_PORT=11946\n"), 0o644); err != nil {
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
	if cfg.Server.Port != 11946 {
		t.Fatalf("expected env override port 11946, got %d", cfg.Server.Port)
	}
	if len(cfg.Terminal.CliClients) != 2 {
		t.Fatalf("expected embedded cli clients, got %d", len(cfg.Terminal.CliClients))
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
		"BACKEND_PORT=11946\n" +
		"TERMINAL_FILES_ENABLED=true\n" +
		"AUTH_ENABLED=true\n" +
		"AUTH_USERNAME=tester\n" +
		"AUTH_PASSWORD_HASH_BCRYPT=$2a$10$abcdefghijklmnopqrstuu4r0JZs6KQ4QvOB0fOkH1ZZ1xd6QbaO\n" +
		"APP_AUTH_ENABLED=true\n" +
		"APP_AUTH_LOCAL_PUBLIC_KEY=test-public-key\n" +
		"APP_AUTH_JWKS_URI=https://issuer.example/.well-known/jwks.json\n" +
		"APP_AUTH_ISSUER=https://issuer.example\n" +
		"APP_AUTH_AUDIENCE=appterm\n"
	if err := os.WriteFile(filepath.Join(repoRoot, ".env"), []byte(envContent), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}
	yamlContent := "server:\n  port: 22000\nterminal:\n  recent-sessions-per-tool: 9\n"
	if err := os.WriteFile(filepath.Join(configsDir, "config.dev.yml"), []byte(yamlContent), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
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
	if cfg.Server.Port != 11946 {
		t.Fatalf("expected env override port 11946, got %d", cfg.Server.Port)
	}
	if cfg.Terminal.RecentSessionsPerTool != 9 {
		t.Fatalf("expected yaml override for recent sessions, got %d", cfg.Terminal.RecentSessionsPerTool)
	}
	if !cfg.Terminal.Files.Enabled {
		t.Fatal("expected env override to enable files")
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
	if cfg.AppAuth.LocalPublicKey != "test-public-key" {
		t.Fatalf("expected local public key env override, got %q", cfg.AppAuth.LocalPublicKey)
	}
	if cfg.AppAuth.JWKSURI != "https://issuer.example/.well-known/jwks.json" {
		t.Fatalf("expected jwks uri env override, got %q", cfg.AppAuth.JWKSURI)
	}
	if cfg.AppAuth.Issuer != "https://issuer.example" || cfg.AppAuth.Audience != "appterm" {
		t.Fatalf("expected issuer/audience env override, got issuer=%q audience=%q", cfg.AppAuth.Issuer, cfg.AppAuth.Audience)
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

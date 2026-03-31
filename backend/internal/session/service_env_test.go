package session

import "testing"

func TestBuildLocalSessionEnvOmitsProcessProxyVariables(t *testing.T) {
	t.Setenv("PATH", "/usr/local/bin:/usr/bin")
	t.Setenv("HOME", "/Users/tester")
	t.Setenv("USER", "tester")
	t.Setenv("LOGNAME", "tester")
	t.Setenv("SHELL", "/bin/zsh")
	t.Setenv("LANG", "en_US.UTF-8")
	t.Setenv("LC_CTYPE", "en_US.UTF-8")
	t.Setenv("TMPDIR", "/tmp/term-webclient")
	t.Setenv("SSH_AUTH_SOCK", "/tmp/ssh-agent.sock")
	t.Setenv("TERM", "")
	t.Setenv("http_proxy", "http://127.0.0.1:8001")
	t.Setenv("https_proxy", "http://127.0.0.1:8001")
	t.Setenv("NO_PROXY", "localhost,127.0.0.1")
	t.Setenv("UNRELATED_FLAG", "should-not-be-inherited")

	env := buildLocalSessionEnv(nil)

	if env["PATH"] != "/usr/local/bin:/usr/bin" {
		t.Fatalf("expected PATH to be preserved, got %q", env["PATH"])
	}
	if env["HOME"] != "/Users/tester" {
		t.Fatalf("expected HOME to be preserved, got %q", env["HOME"])
	}
	if env["LC_CTYPE"] != "en_US.UTF-8" {
		t.Fatalf("expected LC_* vars to be preserved, got %q", env["LC_CTYPE"])
	}
	if env["TERM"] != "xterm-256color" {
		t.Fatalf("expected TERM fallback, got %q", env["TERM"])
	}
	if env["NO_STARSHIP"] != "1" {
		t.Fatalf("expected NO_STARSHIP default, got %q", env["NO_STARSHIP"])
	}
	if _, ok := env["http_proxy"]; ok {
		t.Fatalf("expected http_proxy to be omitted, got %#v", env)
	}
	if _, ok := env["https_proxy"]; ok {
		t.Fatalf("expected https_proxy to be omitted, got %#v", env)
	}
	if _, ok := env["NO_PROXY"]; ok {
		t.Fatalf("expected NO_PROXY to be omitted, got %#v", env)
	}
	if _, ok := env["UNRELATED_FLAG"]; ok {
		t.Fatalf("expected unrelated vars to be omitted, got %#v", env)
	}
}

func TestBuildLocalSessionEnvAllowsExplicitRequestEnvOverrides(t *testing.T) {
	t.Setenv("PATH", "/usr/local/bin:/usr/bin")
	t.Setenv("TERM", "screen-256color")
	t.Setenv("http_proxy", "http://127.0.0.1:8001")

	env := buildLocalSessionEnv(map[string]string{
		"http_proxy":  "http://127.0.0.1:9001",
		"TERM":        "vt100",
		"CUSTOM_VAR":  "enabled",
		"NO_STARSHIP": "0",
	})

	if env["http_proxy"] != "http://127.0.0.1:9001" {
		t.Fatalf("expected explicit request proxy override, got %q", env["http_proxy"])
	}
	if env["TERM"] != "vt100" {
		t.Fatalf("expected explicit TERM override, got %q", env["TERM"])
	}
	if env["CUSTOM_VAR"] != "enabled" {
		t.Fatalf("expected explicit custom env, got %q", env["CUSTOM_VAR"])
	}
	if env["NO_STARSHIP"] != "0" {
		t.Fatalf("expected explicit NO_STARSHIP override, got %q", env["NO_STARSHIP"])
	}
}

func TestBuildLocalSessionEnvPreservesExplicitEmptyNoStarship(t *testing.T) {
	t.Setenv("PATH", "/usr/local/bin:/usr/bin")

	env := buildLocalSessionEnv(map[string]string{
		"NO_STARSHIP": "",
	})

	value, ok := env["NO_STARSHIP"]
	if !ok {
		t.Fatalf("expected NO_STARSHIP key to be preserved, got %#v", env)
	}
	if value != "" {
		t.Fatalf("expected explicit empty NO_STARSHIP to be preserved, got %q", value)
	}
}

func TestBuildCLIClientSessionEnvOnlyUsesExplicitClientAndRequestEnv(t *testing.T) {
	t.Setenv("PATH", "/usr/local/bin:/usr/bin")
	t.Setenv("http_proxy", "http://127.0.0.1:8001")
	t.Setenv("https_proxy", "http://127.0.0.1:8001")

	env := buildCLIClientSessionEnv(
		map[string]string{
			"https_proxy":             "http://127.0.0.1:9001",
			"CLAUDE_CODE_USE_BEDROCK": "1",
			"TERM":                    "screen-256color",
			"NO_STARSHIP":             "0",
		},
		map[string]string{
			"https_proxy": "http://127.0.0.1:9101",
			"CODER":       "true",
			"NO_STARSHIP": "1",
		},
	)

	if _, ok := env["http_proxy"]; ok {
		t.Fatalf("expected process proxy vars to be omitted unless explicitly re-added, got %#v", env)
	}
	if env["https_proxy"] != "http://127.0.0.1:9101" {
		t.Fatalf("expected request env to override client env, got %q", env["https_proxy"])
	}
	if env["CLAUDE_CODE_USE_BEDROCK"] != "1" {
		t.Fatalf("expected explicit client env to be preserved, got %q", env["CLAUDE_CODE_USE_BEDROCK"])
	}
	if env["CODER"] != "true" {
		t.Fatalf("expected explicit request env to be preserved, got %q", env["CODER"])
	}
	if env["TERM"] != "screen-256color" {
		t.Fatalf("expected explicit client TERM to be preserved, got %q", env["TERM"])
	}
	if env["NO_STARSHIP"] != "1" {
		t.Fatalf("expected request NO_STARSHIP to override client env, got %q", env["NO_STARSHIP"])
	}
}

func TestBuildCLIClientSessionEnvDefaultsNoStarshipWhenUnset(t *testing.T) {
	t.Setenv("PATH", "/usr/local/bin:/usr/bin")
	t.Setenv("TERM", "screen-256color")

	env := buildCLIClientSessionEnv(nil, nil)

	if env["NO_STARSHIP"] != "1" {
		t.Fatalf("expected NO_STARSHIP default, got %q", env["NO_STARSHIP"])
	}
	if env["TERM"] != "screen-256color" {
		t.Fatalf("expected TERM to preserve inherited value, got %q", env["TERM"])
	}
}

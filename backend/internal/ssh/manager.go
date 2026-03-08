package sshsvc

import (
	"bytes"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/pkg/sftp"
	gossh "golang.org/x/crypto/ssh"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/termruntime"
	"term-webclient-go/backend/internal/util"
)

type Manager struct {
	cfg        config.SSHConfig
	store      *credentialStore
	knownHosts *knownHostStore
}

func NewManager(cfg config.SSHConfig) *Manager {
	return &Manager{
		cfg:        cfg,
		store:      newCredentialStore(cfg),
		knownHosts: newKnownHostStore(cfg),
	}
}

func (m *Manager) CreateCredential(request model.CreateSshCredentialRequest) (model.SshCredentialResponse, error) {
	return m.store.CreateCredential(request)
}

func (m *Manager) ListCredentials() ([]model.SshCredentialResponse, error) {
	return m.store.ListCredentials()
}

func (m *Manager) DeleteCredential(credentialID string) error {
	return m.store.DeleteCredential(credentialID)
}

func (m *Manager) ResolveCredential(credentialID, overrideHost string, overridePort *int, overrideUsername, overrideTerm string) (ResolvedCredential, error) {
	return m.store.ResolveCredential(credentialID, overrideHost, overridePort, overrideUsername, overrideTerm)
}

func (m *Manager) ListCredentialIDs() ([]string, error) {
	return m.store.ListCredentialIDs()
}

func (m *Manager) Preflight(credentialID string) (model.SshPreflightResponse, error) {
	startedAt := time.Now().UTC()
	resolved, err := m.ResolveCredential(credentialID, "", nil, "", "")
	if err != nil {
		return model.SshPreflightResponse{}, err
	}
	client, err := m.dial(resolved)
	if err != nil {
		durationMs := time.Since(startedAt).Milliseconds()
		return model.SshPreflightResponse{
			CredentialID: credentialID,
			Success:      false,
			Message:      err.Error(),
			DurationMs:   durationMs,
		}, nil
	}
	_ = client.Close()
	return model.SshPreflightResponse{
		CredentialID: credentialID,
		Success:      true,
		Message:      "SSH preflight succeeded",
		DurationMs:   time.Since(startedAt).Milliseconds(),
	}, nil
}

func (m *Manager) Exec(request model.SshExecRequest) (model.SshExecResponse, error) {
	if !m.cfg.Enabled {
		return model.SshExecResponse{}, util.NewStatusError(http.StatusBadRequest, "SSH is disabled", nil)
	}
	if strings.TrimSpace(request.CredentialID) == "" {
		return model.SshExecResponse{}, util.NewStatusError(http.StatusBadRequest, "credentialId must not be blank", nil)
	}
	if strings.TrimSpace(request.Command) == "" {
		return model.SshExecResponse{}, util.NewStatusError(http.StatusBadRequest, "command must not be blank", nil)
	}

	timeoutSeconds := m.cfg.ExecDefaultTimeoutSeconds
	if request.TimeoutSeconds != nil && *request.TimeoutSeconds > 0 {
		timeoutSeconds = *request.TimeoutSeconds
	}
	resolved, err := m.ResolveCredential(request.CredentialID, "", nil, "", "")
	if err != nil {
		return model.SshExecResponse{}, err
	}

	client, err := m.dial(resolved)
	if err != nil {
		return model.SshExecResponse{}, err
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return model.SshExecResponse{}, util.NewStatusError(http.StatusBadRequest, "SSH exec failed", err)
	}
	defer session.Close()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	wrappedCommand, err := wrapExecCommand(request.Command, request.Cwd, request.Env)
	if err != nil {
		return model.SshExecResponse{}, err
	}

	startedAt := time.Now().UTC()
	runDone := make(chan error, 1)
	go func() {
		runDone <- session.Run(wrappedCommand)
	}()

	timedOut := false
	var runErr error
	select {
	case runErr = <-runDone:
	case <-time.After(time.Duration(timeoutSeconds) * time.Second):
		timedOut = true
		_ = session.Close()
		runErr = <-runDone
	}

	exitCode := 0
	if runErr != nil {
		if exitErr, ok := runErr.(*gossh.ExitError); ok {
			exitCode = exitErr.ExitStatus()
		} else if timedOut {
			exitCode = -1
		} else {
			return model.SshExecResponse{}, util.NewStatusError(http.StatusBadRequest, "SSH exec failed", runErr)
		}
	}

	stdoutText, stdoutTruncated := truncateOutput(stdout.String(), m.cfg.ExecMaxOutputBytes)
	stderrText, stderrTruncated := truncateOutput(stderr.String(), m.cfg.ExecMaxOutputBytes)
	return model.SshExecResponse{
		Stdout:          stdoutText,
		Stderr:          stderrText,
		ExitCode:        exitCode,
		DurationMs:      time.Since(startedAt).Milliseconds(),
		TimedOut:        timedOut,
		StdoutTruncated: stdoutTruncated,
		StderrTruncated: stderrTruncated,
	}, nil
}

func (m *Manager) OpenShell(request *model.SshSessionRequest, requestedWorkdir string, cols, rows int) (termruntime.Runtime, string, ResolvedCredential, error) {
	if request == nil {
		return nil, "", ResolvedCredential{}, util.NewStatusError(http.StatusBadRequest, "ssh config is required for SSH_SHELL session", nil)
	}
	resolved, err := m.ResolveCredential(request.CredentialID, request.Host, request.Port, request.Username, request.Term)
	if err != nil {
		return nil, "", ResolvedCredential{}, err
	}
	client, err := m.dial(resolved)
	if err != nil {
		return nil, "", ResolvedCredential{}, err
	}

	rootPath := strings.TrimSpace(requestedWorkdir)
	if rootPath == "" {
		sftpClient, err := sftp.NewClient(client)
		if err == nil {
			if pwd, pwdErr := sftpClient.Getwd(); pwdErr == nil && strings.TrimSpace(pwd) != "" {
				rootPath = pwd
			}
			_ = sftpClient.Close()
		}
	}
	if rootPath == "" {
		rootPath = "."
	}

	runtime, err := newShellRuntime(client, resolved, rootPath, cols, rows)
	if err != nil {
		return nil, "", ResolvedCredential{}, util.NewStatusError(http.StatusBadRequest, "Failed to start ssh shell", err)
	}
	return runtime, rootPath, resolved, nil
}

func (m *Manager) OpenSFTP(credentialID string) (*sftp.Client, func() error, error) {
	resolved, err := m.ResolveCredential(credentialID, "", nil, "", "")
	if err != nil {
		return nil, nil, err
	}
	client, err := m.dial(resolved)
	if err != nil {
		return nil, nil, err
	}
	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		_ = client.Close()
		return nil, nil, util.NewStatusError(http.StatusBadRequest, "Failed to open sftp client", err)
	}
	return sftpClient, func() error {
		_ = sftpClient.Close()
		return client.Close()
	}, nil
}

func (m *Manager) dial(resolved ResolvedCredential) (*gossh.Client, error) {
	authMethod, err := buildAuthMethod(resolved)
	if err != nil {
		return nil, err
	}
	clientConfig := &gossh.ClientConfig{
		User: resolved.Username,
		Auth: []gossh.AuthMethod{authMethod},
		HostKeyCallback: func(hostname string, remote net.Addr, key gossh.PublicKey) error {
			return m.knownHosts.Verify(resolved.Host, resolved.Port, key)
		},
		Timeout: time.Duration(m.cfg.ConnectTimeoutMillis) * time.Millisecond,
	}
	address := net.JoinHostPort(resolved.Host, fmt.Sprintf("%d", resolved.Port))
	client, err := gossh.Dial("tcp", address, clientConfig)
	if err != nil {
		return nil, util.NewStatusError(http.StatusBadRequest, "Failed to connect SSH target", err)
	}
	return client, nil
}

func buildAuthMethod(resolved ResolvedCredential) (gossh.AuthMethod, error) {
	switch resolved.AuthType {
	case model.SshAuthPassword:
		if strings.TrimSpace(resolved.Password) == "" {
			return nil, util.NewStatusError(http.StatusBadRequest, "SSH password is missing for credential "+resolved.CredentialID, nil)
		}
		return gossh.Password(resolved.Password), nil
	case model.SshAuthPrivateKey:
		if strings.TrimSpace(resolved.PrivateKey) == "" {
			return nil, util.NewStatusError(http.StatusBadRequest, "SSH private key is missing for credential "+resolved.CredentialID, nil)
		}
		var signer gossh.Signer
		var err error
		if strings.TrimSpace(resolved.PrivateKeyPassphrase) == "" {
			signer, err = gossh.ParsePrivateKey([]byte(resolved.PrivateKey))
		} else {
			signer, err = gossh.ParsePrivateKeyWithPassphrase([]byte(resolved.PrivateKey), []byte(resolved.PrivateKeyPassphrase))
		}
		if err != nil {
			return nil, util.NewStatusError(http.StatusBadRequest, "SSH private key is invalid", err)
		}
		return gossh.PublicKeys(signer), nil
	default:
		return nil, util.NewStatusError(http.StatusBadRequest, "unsupported ssh auth type", nil)
	}
}

func wrapExecCommand(command, cwd string, env map[string]string) (string, error) {
	var builder strings.Builder
	if trimmedCwd := strings.TrimSpace(cwd); trimmedCwd != "" {
		builder.WriteString("cd ")
		builder.WriteString(shellQuote(trimmedCwd))
		builder.WriteString(" && ")
	}
	for key, value := range env {
		if err := validateShellEnvKey(key); err != nil {
			return "", err
		}
		builder.WriteString(key)
		builder.WriteString("=")
		builder.WriteString(shellQuote(value))
		builder.WriteByte(' ')
	}
	builder.WriteString(command)
	return "bash -lc " + shellQuote(builder.String()), nil
}

func truncateOutput(value string, limit int) (string, bool) {
	if limit <= 0 {
		limit = 1024
	}
	if len(value) <= limit {
		return value, false
	}
	return value[:limit], true
}

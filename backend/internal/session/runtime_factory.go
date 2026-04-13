package session

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	sshsvc "term-webclient-go/backend/internal/ssh"
	"term-webclient-go/backend/internal/termruntime"
	"term-webclient-go/backend/internal/util"
)

var localSessionAllowedEnvKeys = map[string]struct{}{
	"HOME":           {},
	"LANG":           {},
	"LOGNAME":        {},
	"PATH":           {},
	"SHELL":          {},
	"SSH_AUTH_SOCK":  {},
	"TERM":           {},
	"TERMINFO_DIRS":  {},
	"TMPDIR":         {},
	"USER":           {},
}

var localSessionBlockedEnvKeys = map[string]struct{}{
	"ALL_PROXY":   {},
	"HTTP_PROXY":  {},
	"HTTPS_PROXY": {},
	"NO_PROXY":    {},
	"all_proxy":   {},
	"http_proxy":  {},
	"https_proxy": {},
	"no_proxy":    {},
}

type RuntimeFactory struct {
	cfg        *config.Config
	sshManager *sshsvc.Manager
}

func NewRuntimeFactory(cfg *config.Config, sshManager *sshsvc.Manager) *RuntimeFactory {
	return &RuntimeFactory{
		cfg:        cfg,
		sshManager: sshManager,
	}
}

func (f *RuntimeFactory) CreateRuntime(request model.CreateSessionRequest, sessionType model.SessionType) (createParams, termruntime.Runtime, error) {
	cols := 120
	rows := 30
	if request.Cols != nil {
		cols = *request.Cols
	}
	if request.Rows != nil {
		rows = *request.Rows
	}
	if cols <= 0 || rows <= 0 || cols > f.cfg.Terminal.MaxCols || rows > f.cfg.Terminal.MaxRows {
		return createParams{}, nil, util.NewStatusError(http.StatusBadRequest, "terminal size is invalid", nil)
	}

	if sessionType == model.SessionTypeSSHShell {
		title := util.FallbackString(request.TabTitle, "ssh")
		toolID := util.FallbackString(request.ToolID, "ssh")
		runtime, rootPath, resolved, err := f.sshManager.OpenShell(request.SSH, request.Workdir, cols, rows)
		if err != nil {
			return createParams{}, nil, err
		}
		workdir := rootPath
		if strings.TrimSpace(request.Workdir) != "" {
			workdir = strings.TrimSpace(request.Workdir)
		}
		return createParams{
			Workdir:      workdir,
			Cols:         cols,
			Rows:         rows,
			Title:        title,
			ToolID:       toolID,
			FileRootPath: rootPath,
			ResolvedSSH:  &resolved,
		}, runtime, nil
	}

	if strings.TrimSpace(request.ClientID) != "" {
		return f.normalizeCLISession(request, cols, rows)
	}

	command := util.FallbackString(request.Command, f.cfg.Terminal.DefaultCommand)
	if command == "" {
		return createParams{}, nil, util.NewStatusError(http.StatusBadRequest, "command must not be blank", nil)
	}
	args := request.Args
	if args == nil {
		args = append([]string(nil), f.cfg.Terminal.DefaultArgs...)
	}
	workdir := util.FallbackString(request.Workdir, f.cfg.Terminal.DefaultWorkdir)
	if err := validateLocalWorkdir(workdir); err != nil {
		return createParams{}, nil, err
	}
	env := buildLocalSessionEnv(request.Env)

	fullCommand := append([]string{command}, args...)
	runtime, err := termruntime.StartLocal(fullCommand, env, workdir, cols, rows)
	if err != nil {
		return createParams{}, nil, util.NewStatusError(http.StatusBadRequest, "Failed to start terminal runtime", err)
	}
	return createParams{
		Command:      fullCommand,
		Env:          env,
		Workdir:      workdir,
		Cols:         cols,
		Rows:         rows,
		Title:        util.FallbackString(request.TabTitle, command),
		ToolID:       util.FallbackString(request.ToolID, "terminal"),
		FileRootPath: absWorkdir(workdir),
	}, runtime, nil
}

func (f *RuntimeFactory) normalizeCLISession(request model.CreateSessionRequest, cols, rows int) (createParams, termruntime.Runtime, error) {
	clientID := strings.TrimSpace(request.ClientID)
	var client *config.CLIClientConfig
	for idx := range f.cfg.Terminal.CliClients {
		item := &f.cfg.Terminal.CliClients[idx]
		if strings.TrimSpace(item.ID) == clientID {
			client = item
			break
		}
	}
	if client == nil {
		return createParams{}, nil, util.NewStatusError(http.StatusBadRequest, "Unknown cli client: "+clientID, nil)
	}
	command := strings.TrimSpace(client.Command)
	if command == "" {
		return createParams{}, nil, util.NewStatusError(http.StatusBadRequest, "cli client command must not be blank: "+clientID, nil)
	}
	workdir := request.Workdir
	if strings.TrimSpace(workdir) == "" {
		workdir = util.FallbackString(client.Workdir, f.cfg.Terminal.DefaultWorkdir)
	}
	if err := validateLocalWorkdir(workdir); err != nil {
		return createParams{}, nil, err
	}
	env := buildCLIClientSessionEnv(client.Env, request.Env)

	fullCommand := append([]string{command}, client.Args...)
	if preCommands := trimNonEmpty(client.PreCommands); len(preCommands) > 0 {
		defaultCLIShell := "/bin/zsh"
		if runtime.GOOS == "windows" {
			defaultCLIShell = "cmd"
		}
		shell := util.FallbackString(client.Shell, defaultCLIShell)
		script := strings.Join(preCommands, "; ") + "; exec " + shellJoin(fullCommand)
		fullCommand = []string{shell, "-lc", script}
	}
	runtime, err := termruntime.StartLocal(fullCommand, env, workdir, cols, rows)
	if err != nil {
		return createParams{}, nil, util.NewStatusError(http.StatusBadRequest, "Failed to start terminal runtime", err)
	}
	defaultTitle := util.FallbackString(client.Label, clientID)
	return createParams{
		Command:      fullCommand,
		Env:          env,
		Workdir:      workdir,
		Cols:         cols,
		Rows:         rows,
		Title:        util.FallbackString(request.TabTitle, defaultTitle),
		ToolID:       util.FallbackString(request.ToolID, clientID),
		FileRootPath: absWorkdir(workdir),
	}, runtime, nil
}

func validateLocalWorkdir(workdir string) error {
	info, err := os.Stat(workdir)
	if err != nil {
		return util.NewStatusError(http.StatusBadRequest, "workdir must be an existing directory", err)
	}
	if !info.IsDir() {
		return util.NewStatusError(http.StatusBadRequest, "workdir must be an existing directory", err)
	}
	return nil
}

func absWorkdir(workdir string) string {
	absolute, err := filepath.Abs(workdir)
	if err != nil {
		return workdir
	}
	return filepath.Clean(absolute)
}

func buildLocalSessionEnv(overrides map[string]string) map[string]string {
	result := localSessionBaseEnv()
	for key, value := range overrides {
		result[key] = value
	}
	return applyLocalSessionEnvDefaults(result)
}

func buildCLIClientSessionEnv(clientEnv, requestEnv map[string]string) map[string]string {
	result := localSessionBaseEnv()
	for key, value := range clientEnv {
		result[key] = value
	}
	for key, value := range requestEnv {
		result[key] = value
	}
	return applyLocalSessionEnvDefaults(result)
}

func applyLocalSessionEnvDefaults(env map[string]string) map[string]string {
	if _, ok := env["NO_STARSHIP"]; !ok {
		env["NO_STARSHIP"] = "1"
	}
	if strings.TrimSpace(env["TERM"]) == "" {
		env["TERM"] = "xterm-256color"
	}
	return env
}

func localSessionBaseEnv() map[string]string {
	result := map[string]string{}
	for _, entry := range os.Environ() {
		idx := strings.Index(entry, "=")
		if idx <= 0 {
			continue
		}
		key := entry[:idx]
		if _, blocked := localSessionBlockedEnvKeys[key]; blocked {
			continue
		}
		if _, allowed := localSessionAllowedEnvKeys[key]; !allowed && !strings.HasPrefix(key, "LC_") {
			continue
		}
		result[key] = entry[idx+1:]
	}
	return result
}

func trimNonEmpty(items []string) []string {
	result := make([]string, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item) == "" {
			continue
		}
		result = append(result, strings.TrimSpace(item))
	}
	return result
}

func shellJoin(command []string) string {
	parts := make([]string, 0, len(command))
	for _, item := range command {
		parts = append(parts, "'"+strings.ReplaceAll(item, "'", "'\"'\"'")+"'")
	}
	return strings.Join(parts, " ")
}

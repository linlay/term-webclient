//go:build windows

package termruntime

import (
	"context"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/UserExistsError/conpty"
)

type LocalPTYRuntime struct {
	cpty      *conpty.ConPty
	waitOnce  sync.Once
	waitDone  chan struct{}
	waitErr   error
	exitCode  *int
	exitMu    sync.Mutex
	closeOnce sync.Once
}

func StartLocal(command []string, env map[string]string, workdir string, cols, rows int) (*LocalPTYRuntime, error) {
	commandLine := buildCommandLine(command)

	opts := []conpty.ConPtyOption{
		conpty.ConPtyDimensions(cols, rows),
	}
	if workdir != "" {
		opts = append(opts, conpty.ConPtyWorkDir(workdir))
	}
	// Always inherit the full system environment so PATH etc. are available,
	// then overlay any caller-supplied variables.
	merged := mergeEnv(os.Environ(), env)
	opts = append(opts, conpty.ConPtyEnv(merged))

	cpty, err := conpty.Start(commandLine, opts...)
	if err != nil {
		return nil, err
	}
	runtime := &LocalPTYRuntime{
		cpty:     cpty,
		waitDone: make(chan struct{}),
	}
	go runtime.waitLoop()
	return runtime, nil
}

func (r *LocalPTYRuntime) Reader() io.Reader {
	return r.cpty
}

func (r *LocalPTYRuntime) Write(data []byte) (int, error) {
	return r.cpty.Write(data)
}

func (r *LocalPTYRuntime) Resize(cols, rows int) error {
	return r.cpty.Resize(cols, rows)
}

func (r *LocalPTYRuntime) Wait() (int, error) {
	<-r.waitDone
	r.exitMu.Lock()
	defer r.exitMu.Unlock()
	if r.exitCode == nil {
		return -1, r.waitErr
	}
	return *r.exitCode, r.waitErr
}

func (r *LocalPTYRuntime) ExitCode() *int {
	r.exitMu.Lock()
	defer r.exitMu.Unlock()
	if r.exitCode == nil {
		return nil
	}
	value := *r.exitCode
	return &value
}

func (r *LocalPTYRuntime) Close() error {
	r.closeOnce.Do(func() {
		_ = r.cpty.Close()
	})
	return nil
}

func (r *LocalPTYRuntime) waitLoop() {
	r.waitOnce.Do(func() {
		exitCode, err := r.cpty.Wait(context.Background())
		code := int(exitCode)
		r.exitMu.Lock()
		r.waitErr = err
		r.exitCode = &code
		r.exitMu.Unlock()
		close(r.waitDone)
	})
}

// buildCommandLine converts a command slice to a single command line string
// for Windows CreateProcess, using proper quoting rules.
func buildCommandLine(command []string) string {
	if len(command) == 1 {
		return command[0]
	}
	quoted := make([]string, len(command))
	for i, arg := range command {
		if strings.ContainsAny(arg, " \t\"") {
			quoted[i] = `"` + strings.ReplaceAll(arg, `"`, `\"`) + `"`
		} else {
			quoted[i] = arg
		}
	}
	return strings.Join(quoted, " ")
}

// mergeEnv takes the current system environment (as KEY=VALUE slices) and
// overlays the caller-supplied map on top, so custom vars are set while
// system defaults like PATH are preserved.
func mergeEnv(sysEnv []string, extra map[string]string) []string {
	env := make(map[string]string, len(sysEnv)+len(extra))
	for _, entry := range sysEnv {
		if k, v, ok := strings.Cut(entry, "="); ok {
			env[strings.ToUpper(k)] = k + "=" + v // keep original casing in value
		}
	}
	for k, v := range extra {
		env[strings.ToUpper(k)] = k + "=" + v
	}
	result := make([]string, 0, len(env))
	for _, v := range env {
		result = append(result, v)
	}
	return result
}

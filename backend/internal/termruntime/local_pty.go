package termruntime

import (
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"

	"github.com/creack/pty"
)

type LocalPTYRuntime struct {
	cmd       *exec.Cmd
	file      *os.File
	waitOnce  sync.Once
	waitDone  chan struct{}
	waitErr   error
	exitCode  *int
	exitMu    sync.Mutex
	closeOnce sync.Once
}

func StartLocal(command []string, env map[string]string, workdir string, cols, rows int) (*LocalPTYRuntime, error) {
	cmd := exec.Command(command[0], command[1:]...)
	if workdir != "" {
		cmd.Dir = workdir
	}
	if len(env) > 0 {
		cmd.Env = envMapToList(env)
	}
	file, err := pty.StartWithSize(cmd, &pty.Winsize{
		Cols: uint16(cols),
		Rows: uint16(rows),
	})
	if err != nil {
		return nil, err
	}
	runtime := &LocalPTYRuntime{
		cmd:      cmd,
		file:     file,
		waitDone: make(chan struct{}),
	}
	go runtime.waitLoop()
	return runtime, nil
}

func (r *LocalPTYRuntime) Reader() io.Reader {
	return r.file
}

func (r *LocalPTYRuntime) Write(data []byte) (int, error) {
	return r.file.Write(data)
}

func (r *LocalPTYRuntime) Resize(cols, rows int) error {
	return pty.Setsize(r.file, &pty.Winsize{
		Cols: uint16(cols),
		Rows: uint16(rows),
	})
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
		if r.cmd.Process != nil {
			_ = r.cmd.Process.Signal(syscall.SIGTERM)
		}
		_ = r.file.Close()
	})
	return nil
}

func (r *LocalPTYRuntime) waitLoop() {
	r.waitOnce.Do(func() {
		err := r.cmd.Wait()
		code := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				code = exitErr.ExitCode()
			} else {
				code = -1
			}
		}
		r.exitMu.Lock()
		r.waitErr = err
		r.exitCode = &code
		r.exitMu.Unlock()
		close(r.waitDone)
	})
}

func envMapToList(env map[string]string) []string {
	result := make([]string, 0, len(env))
	for key, value := range env {
		result = append(result, key+"="+value)
	}
	return result
}

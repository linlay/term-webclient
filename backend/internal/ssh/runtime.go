package sshsvc

import (
	"io"
	"strings"
	"sync"

	"github.com/pkg/sftp"
	gossh "golang.org/x/crypto/ssh"

	"term-webclient-go/backend/internal/termruntime"
)

var _ termruntime.Runtime = (*ShellRuntime)(nil)

type ShellRuntime struct {
	client    *gossh.Client
	session   *gossh.Session
	stdin     io.WriteCloser
	reader    *io.PipeReader
	writer    *io.PipeWriter
	waitDone  chan struct{}
	waitErr   error
	exitCode  *int
	waitMu    sync.Mutex
	closeOnce sync.Once
}

func newShellRuntime(client *gossh.Client, resolved ResolvedCredential, initialWorkdir string, cols, rows int) (*ShellRuntime, error) {
	session, err := client.NewSession()
	if err != nil {
		_ = client.Close()
		return nil, err
	}
	if err := session.RequestPty(resolved.Term, rows, cols, gossh.TerminalModes{}); err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, err
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, err
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, err
	}
	if err := session.Shell(); err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, err
	}

	reader, writer := io.Pipe()
	runtime := &ShellRuntime{
		client:   client,
		session:  session,
		stdin:    stdin,
		reader:   reader,
		writer:   writer,
		waitDone: make(chan struct{}),
	}
	go runtime.copyStreams(stdout, stderr)
	go runtime.waitLoop()

	if initialWorkdir != "" && initialWorkdir != "." {
		_, _ = runtime.Write([]byte("cd " + shellQuote(initialWorkdir) + "\n"))
	}
	return runtime, nil
}

func (r *ShellRuntime) Reader() io.Reader {
	return r.reader
}

func (r *ShellRuntime) Write(data []byte) (int, error) {
	return r.stdin.Write(data)
}

func (r *ShellRuntime) Resize(cols, rows int) error {
	return r.session.WindowChange(rows, cols)
}

func (r *ShellRuntime) Wait() (int, error) {
	<-r.waitDone
	r.waitMu.Lock()
	defer r.waitMu.Unlock()
	if r.exitCode == nil {
		return -1, r.waitErr
	}
	return *r.exitCode, r.waitErr
}

func (r *ShellRuntime) ExitCode() *int {
	r.waitMu.Lock()
	defer r.waitMu.Unlock()
	if r.exitCode == nil {
		return nil
	}
	value := *r.exitCode
	return &value
}

func (r *ShellRuntime) Close() error {
	r.closeOnce.Do(func() {
		_ = r.stdin.Close()
		_ = r.session.Close()
		_ = r.client.Close()
		_ = r.writer.Close()
		_ = r.reader.Close()
	})
	return nil
}

func (r *ShellRuntime) copyStreams(stdout, stderr io.Reader) {
	var copyWG sync.WaitGroup
	copyWG.Add(2)
	go func() {
		defer copyWG.Done()
		_, _ = io.Copy(r.writer, stdout)
	}()
	go func() {
		defer copyWG.Done()
		_, _ = io.Copy(r.writer, stderr)
	}()
	copyWG.Wait()
	_ = r.writer.Close()
}

func (r *ShellRuntime) waitLoop() {
	err := r.session.Wait()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*gossh.ExitError); ok {
			exitCode = exitErr.ExitStatus()
		} else {
			exitCode = -1
		}
	}
	r.waitMu.Lock()
	r.waitErr = err
	r.exitCode = &exitCode
	r.waitMu.Unlock()
	close(r.waitDone)
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

type sftpSession struct {
	Client *sftp.Client
	Close  func() error
}

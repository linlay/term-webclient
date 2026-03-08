package termruntime

import "io"

type Runtime interface {
	Reader() io.Reader
	Write(data []byte) (int, error)
	Resize(cols, rows int) error
	Wait() (int, error)
	ExitCode() *int
	Close() error
}

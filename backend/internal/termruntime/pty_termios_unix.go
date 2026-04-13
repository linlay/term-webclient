//go:build !windows

package termruntime

import (
	"os"

	"golang.org/x/sys/unix"
)

// configurePTYTermios sets essential termios attributes on the PTY master fd.
// It ensures VERASE matches xterm.js's Backspace (0x7f / DEL) and that ECHOE
// is enabled so erased characters produce the visual BS-SP-BS sequence.
// This is best-effort: errors are silently ignored to avoid blocking sessions.
func configurePTYTermios(f *os.File) {
	fd := int(f.Fd())

	termios, err := unix.IoctlGetTermios(fd, ioctlGetTermios)
	if err != nil {
		return
	}

	termios.Cc[unix.VERASE] = 0x7f       // DEL — matches xterm.js Backspace
	termios.Lflag |= unix.ECHOE          // erase produces BS-SP-BS

	_ = unix.IoctlSetTermios(fd, ioctlSetTermios, termios)
}

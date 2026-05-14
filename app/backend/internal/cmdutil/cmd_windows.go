//go:build windows

package cmdutil

import (
	"os/exec"
	"syscall"
)

func ConfigureForBackground(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

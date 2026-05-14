//go:build !windows

package cmdutil

import "os/exec"

func ConfigureForBackground(cmd *exec.Cmd) {}

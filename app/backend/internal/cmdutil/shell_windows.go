//go:build windows

package cmdutil

import (
	"context"
	"os/exec"
)

// CommandContext runs commands through cmd.exe to avoid PowerShell execution-policy
// issues with wrappers like npm.ps1.
func CommandContext(ctx context.Context, command string) *exec.Cmd {
	return exec.CommandContext(ctx, "cmd.exe", "/d", "/s", "/c", command)
}

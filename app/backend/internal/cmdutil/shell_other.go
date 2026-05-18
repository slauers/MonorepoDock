//go:build !windows

package cmdutil

import (
	"context"
	"os/exec"
)

func CommandContext(ctx context.Context, _ string, command string) *exec.Cmd {
	return exec.CommandContext(ctx, "sh", "-lc", command)
}

func ShouldSetCommandDir(_ string) bool {
	return true
}

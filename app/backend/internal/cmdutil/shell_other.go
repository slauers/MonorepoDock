//go:build !windows

package cmdutil

import (
	"context"
	"os/exec"
)

func CommandContext(ctx context.Context, command string) *exec.Cmd {
	return exec.CommandContext(ctx, "sh", "-lc", command)
}

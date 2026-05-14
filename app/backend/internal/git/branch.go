package git

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"strings"
)

func CurrentBranch(ctx context.Context, repoPath string) (string, error) {
	if strings.TrimSpace(repoPath) == "" {
		return "", errors.New("repo path is required")
	}

	cmd := exec.CommandContext(ctx, "git", "-C", repoPath, "branch", "--show-current")
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", err
	}

	return strings.TrimSpace(out.String()), nil
}


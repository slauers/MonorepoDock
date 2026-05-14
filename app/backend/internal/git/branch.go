package git

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"

	"monodock/backend/internal/cmdutil"
)

func CurrentBranch(ctx context.Context, repoPath string) (string, error) {
	if strings.TrimSpace(repoPath) == "" {
		return "", errors.New("repo path is required")
	}

	top, err := runGit(ctx, repoPath, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", err
	}

	branch, err := runGit(ctx, top, "symbolic-ref", "--short", "HEAD")
	if err == nil && branch != "" {
		return branch, nil
	}

	commit, commitErr := runGit(ctx, top, "rev-parse", "--short", "HEAD")
	if commitErr == nil && commit != "" {
		return "detached@" + commit, nil
	}

	if err != nil {
		return "", err
	}
	return "", commitErr
}

func runGit(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmdutil.ConfigureForBackground(cmd)
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errMsg := strings.TrimSpace(stderr.String())
		if errMsg == "" {
			errMsg = err.Error()
		}
		return "", fmt.Errorf("git %s: %s", strings.Join(args, " "), errMsg)
	}

	return strings.TrimSpace(out.String()), nil
}

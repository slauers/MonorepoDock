package affected

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"monodock/backend/internal/cmdutil"
	"monodock/backend/internal/workspace"
)

type Service struct{}

func NewService() *Service {
	return &Service{}
}

func (s *Service) Analyze(ctx context.Context, root string, summary workspace.Summary) (Report, error) {
	report := Report{
		WorkspaceRoot: root,
		ChangedFiles:  []ChangedFile{},
		Projects:      []AffectedProject{},
		GeneratedAt:   time.Now().UTC(),
	}

	files, notGit, msg, err := s.GetChangedFiles(ctx, root)
	if err != nil {
		return report, err
	}
	report.ChangedFiles = files
	report.NotGitRepository = notGit
	report.Message = msg
	if notGit {
		return report, nil
	}

	report.Projects = FindAffectedProjects(summary, files)
	return report, nil
}

func (s *Service) GetChangedFiles(ctx context.Context, root string) ([]ChangedFile, bool, string, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cmd := cmdutil.CommandContext(timeoutCtx, root, "git status --porcelain")
	if cmdutil.ShouldSetCommandDir(root) {
		cmd.Dir = root
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		text := strings.ToLower(string(out) + " " + err.Error())
		if strings.Contains(text, "not a git repository") {
			return []ChangedFile{}, true, "This workspace is not a Git repository", nil
		}
		if errors.Is(timeoutCtx.Err(), context.DeadlineExceeded) {
			return nil, false, "", timeoutCtx.Err()
		}
		return nil, false, "", err
	}

	lines := strings.Split(strings.ReplaceAll(string(out), "\r\n", "\n"), "\n")
	files := make([]ChangedFile, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimRight(line, " ")
		if len(strings.TrimSpace(line)) == 0 || len(line) < 3 {
			continue
		}
		status := strings.TrimSpace(line[:2])
		if status == "" {
			status = "?"
		}
		pathPart := strings.TrimSpace(line[3:])
		if strings.Contains(pathPart, " -> ") {
			parts := strings.Split(pathPart, " -> ")
			pathPart = parts[len(parts)-1]
		}
		pathPart = filepath.ToSlash(filepath.Clean(pathPart))
		files = append(files, ChangedFile{
			Path:   pathPart,
			Status: status,
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files, false, "", nil
}

func FindAffectedProjects(summary workspace.Summary, changedFiles []ChangedFile) []AffectedProject {
	result := make([]AffectedProject, 0)
	for _, project := range summary.Projects {
		root := strings.Trim(filepath.ToSlash(project.Path), "/")
		matches := make([]ChangedFile, 0)
		for _, file := range changedFiles {
			path := strings.Trim(filepath.ToSlash(file.Path), "/")
			if root == "" || root == "." {
				matches = append(matches, file)
				continue
			}
			if path == root || strings.HasPrefix(path, root+"/") {
				matches = append(matches, file)
			}
		}
		if len(matches) == 0 {
			continue
		}
		result = append(result, AffectedProject{
			Name:         project.Name,
			Root:         project.Path,
			ChangedFiles: matches,
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result
}

func isExecNotFound(err error) bool {
	var e *exec.Error
	return errors.As(err, &e)
}

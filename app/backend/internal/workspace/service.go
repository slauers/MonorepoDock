package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"monodock/backend/internal/detector"
	gitinfo "monodock/backend/internal/git"
)

type Service struct{}

func NewService() *Service {
	return &Service{}
}

func (s *Service) Inspect(ctx context.Context, root string) (Summary, error) {
	select {
	case <-ctx.Done():
		return Summary{}, ctx.Err()
	default:
	}

	if root == "" {
		return Summary{}, errors.New("root path is required")
	}

	absRoot, err := filepath.Abs(root)
	if err != nil {
		return Summary{}, fmt.Errorf("resolve absolute path: %w", err)
	}

	detectResult, err := detector.Detect(absRoot)
	if err != nil {
		return Summary{}, fmt.Errorf("detect workspace tools: %w", err)
	}

	projects, err := findProjects(absRoot, detectResult.PackageManager)
	if err != nil {
		return Summary{}, fmt.Errorf("find projects: %w", err)
	}

	branch, err := gitinfo.CurrentBranch(ctx, absRoot)
	if err != nil {
		branch = "unversioned"
	}

	return Summary{
		RootPath:       absRoot,
		RootPaths:      []string{absRoot},
		PackageManager: detectResult.PackageManager,
		MonorepoTool:   detectResult.MonorepoTool,
		GitBranch:      branch,
		Projects:       projects,
	}, nil
}

type manifest struct {
	Name    string            `json:"name"`
	Scripts map[string]string `json:"scripts"`
}

func findProjects(root, packageManager string) ([]Project, error) {
	projectsByPath := map[string]Project{}

	if err := collectPackageJSONProjects(root, packageManager, projectsByPath); err != nil {
		return nil, err
	}
	if err := collectGoProjects(root, projectsByPath); err != nil {
		return nil, err
	}
	if err := collectDockerComposeProject(root, projectsByPath); err != nil {
		return nil, err
	}

	projects := make([]Project, 0, len(projectsByPath))
	for _, project := range projectsByPath {
		sort.Strings(project.Scripts)
		sort.Slice(project.Targets, func(i, j int) bool {
			return project.Targets[i].Name < project.Targets[j].Name
		})
		projects = append(projects, project)
	}

	sort.Slice(projects, func(i, j int) bool {
		return projects[i].Path < projects[j].Path
	})

	return projects, nil
}

func collectPackageJSONProjects(root, packageManager string, out map[string]Project) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			base := d.Name()
			if base == "node_modules" || base == ".git" || base == "dist" || base == "build" {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Name() != "package.json" {
			return nil
		}

		project, ok, err := parsePackageJSONProject(path, root, packageManager)
		if err != nil {
			return err
		}
		if ok {
			out[project.Path] = project
		}
		return nil
	})
}

func parsePackageJSONProject(packageJSONPath, root, packageManager string) (Project, bool, error) {
	raw, err := os.ReadFile(packageJSONPath)
	if err != nil {
		return Project{}, false, err
	}

	var doc manifest
	if err := json.Unmarshal(raw, &doc); err != nil {
		return Project{}, false, nil
	}

	projectDir := filepath.Dir(packageJSONPath)
	rel, err := filepath.Rel(root, projectDir)
	if err != nil {
		return Project{}, false, err
	}

	rel = filepath.ToSlash(rel)
	if rel == "." {
		rel = "/"
	}

	name := strings.TrimSpace(doc.Name)
	if name == "" {
		name = rel
	}

	scripts := make([]string, 0, len(doc.Scripts))
	targets := make([]Target, 0, len(doc.Scripts))
	for scriptName := range doc.Scripts {
		scripts = append(scripts, scriptName)
		targets = append(targets, Target{
			ID:      targetID(rel, "script", scriptName),
			Name:    scriptName,
			Command: runScriptCommand(packageManager, scriptName),
			WorkDir: projectDir,
			Kind:    "script",
		})
	}

	return Project{
		Name:    name,
		Path:    rel,
		Scripts: scripts,
		Targets: targets,
	}, true, nil
}

func collectGoProjects(root string, out map[string]Project) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			base := d.Name()
			if base == "node_modules" || base == ".git" || base == "dist" || base == "build" {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Name() != "go.mod" {
			return nil
		}

		projectDir := filepath.Dir(path)
		rel, err := filepath.Rel(root, projectDir)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			rel = "/"
		}
		if _, exists := out[rel]; exists {
			return nil
		}

		name := "go:" + filepath.Base(projectDir)
		out[rel] = Project{
			Name: name,
			Path: rel,
			Targets: []Target{
				{
					ID:      targetID(rel, "go", "run"),
					Name:    "run",
					Command: "go run .",
					WorkDir: projectDir,
					Kind:    "go",
				},
				{
					ID:      targetID(rel, "go", "test"),
					Name:    "test",
					Command: "go test ./...",
					WorkDir: projectDir,
					Kind:    "go",
				},
			},
		}
		return nil
	})
}

func collectDockerComposeProject(root string, out map[string]Project) error {
	composeFiles := []string{
		"docker-compose.yml",
		"docker-compose.yaml",
		"compose.yml",
		"compose.yaml",
	}

	for _, file := range composeFiles {
		composePath := filepath.Join(root, file)
		info, err := os.Stat(composePath)
		if err != nil || info.IsDir() {
			continue
		}

		rel := "/"
		project := Project{
			Name: "docker-compose",
			Path: rel,
			Targets: []Target{
				{
					ID:      targetID(rel, "docker", "up"),
					Name:    "up",
					Command: "docker compose up -d",
					WorkDir: root,
					Kind:    "docker",
				},
				{
					ID:      targetID(rel, "docker", "down"),
					Name:    "down",
					Command: "docker compose down",
					WorkDir: root,
					Kind:    "docker",
				},
				{
					ID:      targetID(rel, "docker", "restart"),
					Name:    "restart",
					Command: "docker compose restart",
					WorkDir: root,
					Kind:    "docker",
				},
			},
		}

		existing, ok := out[rel]
		if ok {
			existing.Targets = append(existing.Targets, project.Targets...)
			out[rel] = existing
		} else {
			out[rel] = project
		}
		break
	}

	return nil
}

func runScriptCommand(packageManager, script string) string {
	switch packageManager {
	case "pnpm":
		return "pnpm run " + script
	case "yarn":
		return "yarn " + script
	case "bun":
		return "bun run " + script
	default:
		return "npm run " + script
	}
}

func targetID(projectPath, kind, name string) string {
	base := strings.ReplaceAll(projectPath, "/", "_")
	base = strings.ReplaceAll(base, "\\", "_")
	if base == "_" || base == "." || base == "" {
		base = "root"
	}
	return kind + ":" + base + ":" + name
}

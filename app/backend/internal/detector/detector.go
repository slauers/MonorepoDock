package detector

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type Result struct {
	PackageManager string
	MonorepoTool   string
}

type packageJSON struct {
	Workspaces any `json:"workspaces"`
}

func Detect(root string) (Result, error) {
	if root == "" {
		return Result{}, errors.New("root path is required")
	}

	pm := detectPackageManager(root)
	tool := detectMonorepoTool(root)

	if tool == "" && hasWorkspacesInPackageJSON(root) {
		tool = "workspaces"
	}

	return Result{
		PackageManager: pm,
		MonorepoTool:   tool,
	}, nil
}

func detectPackageManager(root string) string {
	switch {
	case fileExists(filepath.Join(root, "pnpm-lock.yaml")):
		return "pnpm"
	case fileExists(filepath.Join(root, "yarn.lock")):
		return "yarn"
	case fileExists(filepath.Join(root, "package-lock.json")):
		return "npm"
	case fileExists(filepath.Join(root, "bun.lockb")) || fileExists(filepath.Join(root, "bun.lock")):
		return "bun"
	default:
		return "unknown"
	}
}

func detectMonorepoTool(root string) string {
	switch {
	case fileExists(filepath.Join(root, "nx.json")):
		return "nx"
	case fileExists(filepath.Join(root, "turbo.json")) || fileExists(filepath.Join(root, "turbo.jsonc")):
		return "turborepo"
	case fileExists(filepath.Join(root, "pnpm-workspace.yaml")):
		return "pnpm-workspace"
	case fileExists(filepath.Join(root, "go.work")):
		return "go-workspace"
	default:
		return ""
	}
}

func hasWorkspacesInPackageJSON(root string) bool {
	raw, err := os.ReadFile(filepath.Join(root, "package.json"))
	if err != nil {
		return false
	}

	var pkg packageJSON
	if err := json.Unmarshal(raw, &pkg); err != nil {
		return false
	}

	switch v := pkg.Workspaces.(type) {
	case []any:
		return len(v) > 0
	case map[string]any:
		packages, ok := v["packages"]
		if !ok {
			return false
		}
		items, ok := packages.([]any)
		return ok && len(items) > 0
	case string:
		return strings.TrimSpace(v) != ""
	default:
		return false
	}
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}


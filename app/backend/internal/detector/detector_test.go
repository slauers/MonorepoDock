package detector

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectPnpmNx(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "pnpm-lock.yaml"), "lockfile")
	writeFile(t, filepath.Join(root, "nx.json"), "{}")

	result, err := Detect(root)
	if err != nil {
		t.Fatalf("detect should not fail: %v", err)
	}

	if result.PackageManager != "pnpm" {
		t.Fatalf("expected pnpm, got %s", result.PackageManager)
	}
	if result.MonorepoTool != "nx" {
		t.Fatalf("expected nx, got %s", result.MonorepoTool)
	}
}

func TestDetectWorkspacesFallback(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "package.json"), `{"workspaces":["apps/*"]}`)

	result, err := Detect(root)
	if err != nil {
		t.Fatalf("detect should not fail: %v", err)
	}
	if result.MonorepoTool != "workspaces" {
		t.Fatalf("expected workspaces, got %s", result.MonorepoTool)
	}
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write file %s: %v", path, err)
	}
}


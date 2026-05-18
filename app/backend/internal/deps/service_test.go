package deps

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"monodock/backend/internal/workspace"
)

func TestAnalyzeDetectsInternalPackageDependencies(t *testing.T) {
	root := t.TempDir()

	writePackage(t, root, "apps/web/package.json", `{
		"name": "@demo/web",
		"dependencies": {
			"@demo/shared": "0.1.0",
			"@demo/ui": "0.1.0"
		},
		"devDependencies": {
			"@demo/tokens": "0.1.0"
		}
	}`)
	writePackage(t, root, "apps/api/package.json", `{
		"name": "@demo/api",
		"dependencies": {
			"@demo/shared": "0.1.0"
		}
	}`)
	writePackage(t, root, "packages/shared/package.json", `{
		"name": "@demo/shared",
		"dependencies": {
			"@demo/tokens": "0.1.0"
		}
	}`)
	writePackage(t, root, "packages/ui/package.json", `{
		"name": "@demo/ui",
		"dependencies": {
			"@demo/tokens": "0.1.0"
		}
	}`)
	writePackage(t, root, "packages/tokens/package.json", `{
		"name": "@demo/tokens"
	}`)

	summary := workspace.Summary{
		RootPath: root,
		Projects: []workspace.Project{
			project(root, "@demo/web", "apps/web"),
			project(root, "@demo/api", "apps/api"),
			project(root, "@demo/shared", "packages/shared"),
			project(root, "@demo/ui", "packages/ui"),
			project(root, "@demo/tokens", "packages/tokens"),
		},
	}

	report, err := NewService().Analyze(context.Background(), root, summary)
	if err != nil {
		t.Fatalf("Analyze returned error: %v", err)
	}

	nodes := map[string]DependencyNode{}
	for _, node := range report.Nodes {
		nodes[node.Project] = node
	}

	assertStrings(t, nodes["@demo/web"].DependsOn, []string{"@demo/shared", "@demo/tokens", "@demo/ui"})
	assertStrings(t, nodes["@demo/shared"].UsedBy, []string{"@demo/api", "@demo/web"})
	assertStrings(t, nodes["@demo/ui"].UsedBy, []string{"@demo/web"})
	assertStrings(t, nodes["@demo/tokens"].UsedBy, []string{"@demo/shared", "@demo/ui", "@demo/web"})
	assertStrings(t, nodes["@demo/tokens"].Impact.DirectDependents, []string{"@demo/shared", "@demo/ui", "@demo/web"})
	assertStrings(t, nodes["@demo/tokens"].Impact.TransitiveDependents, []string{"@demo/api"})
	assertStrings(t, nodes["@demo/shared"].Impact.TransitiveDependents, []string{})

	if len(report.Edges) != 6 {
		t.Fatalf("expected 6 edges, got %d", len(report.Edges))
	}
	if report.Message != "" {
		t.Fatalf("expected empty message when dependencies are found, got %q", report.Message)
	}
}

func writePackage(t *testing.T, root, relPath, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(relPath))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create package dir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write package: %v", err)
	}
}

func project(root, name, relPath string) workspace.Project {
	workDir := filepath.Join(root, filepath.FromSlash(relPath))
	return workspace.Project{
		Name: name,
		Path: relPath,
		Targets: []workspace.Target{
			{WorkDir: workDir},
		},
	}
}

func assertStrings(t *testing.T, actual, expected []string) {
	t.Helper()
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}

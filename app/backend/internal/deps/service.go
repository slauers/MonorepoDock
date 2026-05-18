package deps

import (
	"context"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"monodock/backend/internal/workspace"
)

type Service struct{}

func NewService() *Service {
	return &Service{}
}

type projectInfo struct {
	project     workspace.Project
	dir         string
	packageName string
	deps        []string
}

func (s *Service) Analyze(ctx context.Context, root string, summary workspace.Summary) (Report, error) {
	report := Report{
		WorkspaceRoot: root,
		Nodes:         []DependencyNode{},
		Edges:         []DependencyEdge{},
		GeneratedAt:   time.Now().UTC(),
	}

	select {
	case <-ctx.Done():
		return report, ctx.Err()
	default:
	}

	projects := make([]projectInfo, 0, len(summary.Projects))
	packageToProject := map[string]string{}

	for _, project := range summary.Projects {
		dir := projectDir(root, project)
		info := projectInfo{project: project, dir: dir}
		if dir != "" {
			manifest, ok, err := readPackageManifest(filepath.Join(dir, "package.json"))
			if err != nil {
				return report, err
			}
			if ok {
				info.packageName = strings.TrimSpace(manifest.Name)
				info.deps = manifest.dependencyNames()
			}
		}

		if info.packageName != "" {
			packageToProject[info.packageName] = project.Name
		}
		// Nx and some workspace tools use project names as internal dependency identifiers.
		packageToProject[project.Name] = project.Name
		projects = append(projects, info)
	}

	dependsOn := map[string]map[string]bool{}
	usedBy := map[string]map[string]bool{}
	edgeKeys := map[string]bool{}

	for _, info := range projects {
		for _, depName := range info.deps {
			internalProject := packageToProject[depName]
			if internalProject == "" || internalProject == info.project.Name {
				continue
			}
			if dependsOn[info.project.Name] == nil {
				dependsOn[info.project.Name] = map[string]bool{}
			}
			if usedBy[internalProject] == nil {
				usedBy[internalProject] = map[string]bool{}
			}
			dependsOn[info.project.Name][internalProject] = true
			usedBy[internalProject][info.project.Name] = true

			key := info.project.Name + "\x00" + internalProject + "\x00" + depName
			if edgeKeys[key] {
				continue
			}
			edgeKeys[key] = true
			report.Edges = append(report.Edges, DependencyEdge{
				From:       info.project.Name,
				To:         internalProject,
				Dependency: depName,
			})
		}
	}

	for _, info := range projects {
		directDependencies := sortedKeys(dependsOn[info.project.Name])
		directDependents := sortedKeys(usedBy[info.project.Name])
		report.Nodes = append(report.Nodes, DependencyNode{
			Project:     info.project.Name,
			Path:        info.project.Path,
			PackageName: info.packageName,
			DependsOn:   directDependencies,
			UsedBy:      directDependents,
			Impact: DependencyImpact{
				Project:              info.project.Name,
				DirectDependencies:   directDependencies,
				DirectDependents:     directDependents,
				TransitiveDependents: transitiveDependents(info.project.Name, usedBy),
			},
		})
	}

	sort.Slice(report.Nodes, func(i, j int) bool {
		leftImpact := len(report.Nodes[i].UsedBy)
		rightImpact := len(report.Nodes[j].UsedBy)
		if leftImpact != rightImpact {
			return leftImpact > rightImpact
		}
		return report.Nodes[i].Project < report.Nodes[j].Project
	})
	sort.Slice(report.Edges, func(i, j int) bool {
		if report.Edges[i].From != report.Edges[j].From {
			return report.Edges[i].From < report.Edges[j].From
		}
		if report.Edges[i].To != report.Edges[j].To {
			return report.Edges[i].To < report.Edges[j].To
		}
		return report.Edges[i].Dependency < report.Edges[j].Dependency
	})

	if len(projects) == 0 {
		report.Message = "No projects detected in this workspace."
	} else if len(report.Edges) == 0 {
		report.Message = "No internal package dependencies detected."
	}
	return report, nil
}

func projectDir(root string, project workspace.Project) string {
	for _, target := range project.Targets {
		if strings.TrimSpace(target.WorkDir) != "" {
			return target.WorkDir
		}
	}
	root = strings.TrimSpace(root)
	projectPath := strings.TrimSpace(project.Path)
	if root == "" || strings.HasPrefix(root, "group:") || projectPath == "" {
		return ""
	}
	if projectPath == "/" || projectPath == "." {
		return root
	}
	return filepath.Join(root, filepath.FromSlash(projectPath))
}

func sortedKeys(items map[string]bool) []string {
	if len(items) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(items))
	for item := range items {
		out = append(out, item)
	}
	sort.Strings(out)
	return out
}

func transitiveDependents(project string, usedBy map[string]map[string]bool) []string {
	direct := usedBy[project]
	visited := map[string]bool{}
	queue := make([]string, 0, len(direct))

	for dependent := range direct {
		visited[dependent] = true
		queue = append(queue, dependent)
	}

	impacted := map[string]bool{}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		nextDependents := usedBy[current]
		for next := range nextDependents {
			if visited[next] {
				continue
			}
			visited[next] = true
			impacted[next] = true
			queue = append(queue, next)
		}
	}

	return sortedKeys(impacted)
}

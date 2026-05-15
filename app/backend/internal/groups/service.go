package groups

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"monodock/backend/internal/workspace"
)

type Service struct {
	store *Store
}

func NewService(baseDir string) (*Service, error) {
	store, err := NewStore(baseDir)
	if err != nil {
		return nil, err
	}
	return &Service{store: store}, nil
}

func (s *Service) ListGroups() ([]Group, error) {
	items, err := s.store.List()
	if err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})
	return items, nil
}

func (s *Service) SaveGroup(group Group) error {
	group.Name = strings.TrimSpace(group.Name)
	if group.Name == "" {
		return errors.New("group name is required")
	}
	roots := make([]string, 0, len(group.Roots))
	seen := map[string]bool{}
	for _, root := range group.Roots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		abs, err := filepath.Abs(root)
		if err != nil {
			return err
		}
		key := strings.ToLower(abs)
		if seen[key] {
			continue
		}
		seen[key] = true
		roots = append(roots, abs)
	}
	if len(roots) == 0 {
		return errors.New("group must have at least one root")
	}
	group.Roots = roots
	if group.ID == "" {
		group.ID = generateID("group")
	}

	items, err := s.store.List()
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	createdAt := now
	replaced := false
	for i := range items {
		if items[i].ID != group.ID {
			continue
		}
		createdAt = items[i].CreatedAt
		group.CreatedAt = createdAt
		group.UpdatedAt = now
		items[i] = group
		replaced = true
		break
	}
	if !replaced {
		group.CreatedAt = createdAt
		group.UpdatedAt = now
		items = append(items, group)
	}
	return s.store.SaveAll(items)
}

func (s *Service) DeleteGroup(groupID string) error {
	groupID = strings.TrimSpace(groupID)
	if groupID == "" {
		return errors.New("group id is required")
	}
	items, err := s.store.List()
	if err != nil {
		return err
	}
	out := make([]Group, 0, len(items))
	for _, group := range items {
		if group.ID == groupID {
			continue
		}
		out = append(out, group)
	}
	return s.store.SaveAll(out)
}

func (s *Service) InspectGroup(ctx context.Context, groupID string, workspaceSvc *workspace.Service) (workspace.Summary, error) {
	if workspaceSvc == nil {
		return workspace.Summary{}, errors.New("workspace service is required")
	}
	groupID = strings.TrimSpace(groupID)
	items, err := s.store.List()
	if err != nil {
		return workspace.Summary{}, err
	}
	var group *Group
	for i := range items {
		if items[i].ID == groupID {
			group = &items[i]
			break
		}
	}
	if group == nil {
		return workspace.Summary{}, errors.New("group not found")
	}

	combined := workspace.Summary{
		RootPath:       "group:" + group.Name,
		RootPaths:      append([]string{}, group.Roots...),
		PackageManager: "mixed",
		MonorepoTool:   "workspace-group",
		GitBranch:      "group",
		Projects:       []workspace.Project{},
	}
	pm := ""
	samePM := true
	projects := make([]workspace.Project, 0)
	for _, root := range group.Roots {
		summary, inspectErr := workspaceSvc.Inspect(ctx, root)
		if inspectErr != nil {
			continue
		}
		if pm == "" {
			pm = summary.PackageManager
		} else if pm != summary.PackageManager {
			samePM = false
		}
		rootLabel := filepath.Base(root)
		if rootLabel == "" {
			rootLabel = root
		}
		for _, project := range summary.Projects {
			project.Name = rootLabel + " / " + project.Name
			project.Path = rootLabel + ":" + project.Path
			for i := range project.Targets {
				project.Targets[i].ID = "group:" + group.ID + ":" + project.Targets[i].ID
			}
			projects = append(projects, project)
		}
	}
	if samePM && pm != "" {
		combined.PackageManager = pm
	}
	sort.Slice(projects, func(i, j int) bool {
		return projects[i].Path < projects[j].Path
	})
	combined.Projects = projects
	return combined, nil
}

func generateID(prefix string) string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(buf)
}

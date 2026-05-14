package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const maxRecentWorkspaces = 20

type RecentWorkspace struct {
	Path       string    `json:"path"`
	LastOpened time.Time `json:"lastOpened"`
}

type Store struct {
	filePath string
}

func NewStore(baseDir string) (*Store, error) {
	if baseDir == "" {
		return nil, errors.New("base directory is required")
	}

	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return nil, fmt.Errorf("create config directory: %w", err)
	}

	return &Store{
		filePath: filepath.Join(baseDir, "recent-workspaces.json"),
	}, nil
}

func (s *Store) List() ([]RecentWorkspace, error) {
	raw, err := os.ReadFile(s.filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []RecentWorkspace{}, nil
		}
		return nil, err
	}

	var items []RecentWorkspace
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}

	return items, nil
}

func (s *Store) Add(path string) error {
	if path == "" {
		return errors.New("workspace path is required")
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return err
	}

	items, err := s.List()
	if err != nil {
		return err
	}

	out := []RecentWorkspace{{
		Path:       absPath,
		LastOpened: time.Now().UTC(),
	}}

	for _, item := range items {
		if item.Path == absPath {
			continue
		}
		out = append(out, item)
		if len(out) >= maxRecentWorkspaces {
			break
		}
	}

	payload, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.filePath, payload, 0o644)
}


package groups

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type Store struct {
	filePath string
	mu       sync.Mutex
}

func NewStore(baseDir string) (*Store, error) {
	if baseDir == "" {
		return nil, errors.New("base directory is required")
	}
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return nil, fmt.Errorf("create config directory: %w", err)
	}
	return &Store{filePath: filepath.Join(baseDir, "workspace-groups.json")}, nil
}

func (s *Store) List() ([]Group, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	raw, err := os.ReadFile(s.filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Group{}, nil
		}
		return nil, err
	}
	var groups []Group
	if err := json.Unmarshal(raw, &groups); err != nil {
		return nil, err
	}
	return groups, nil
}

func (s *Store) SaveAll(groups []Group) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	payload, err := json.MarshalIndent(groups, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath, payload, 0o644)
}

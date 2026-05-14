package profiles

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type Store struct {
	mu       sync.Mutex
	filePath string
}

func NewStore(baseDir string) (*Store, error) {
	if baseDir == "" {
		return nil, errors.New("base directory is required")
	}

	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return nil, fmt.Errorf("create profiles directory: %w", err)
	}

	return &Store{
		filePath: filepath.Join(baseDir, "profiles.json"),
	}, nil
}

func (s *Store) LoadProfiles() ([]Profile, error) {
	raw, err := os.ReadFile(s.filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Profile{}, nil
		}
		return nil, err
	}

	var items []Profile
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) SaveProfiles(items []Profile) error {
	payload, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath, payload, 0o644)
}

func (s *Store) ListProfiles() ([]Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.LoadProfiles()
}

func (s *Store) AddOrUpdateProfile(profile Profile) error {
	if profile.ID == "" {
		return errors.New("profile id is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	items, err := s.LoadProfiles()
	if err != nil {
		return err
	}

	for i := range items {
		if items[i].ID == profile.ID {
			items[i] = profile
			return s.SaveProfiles(items)
		}
	}

	items = append(items, profile)
	return s.SaveProfiles(items)
}

func (s *Store) DeleteProfile(profileID string) error {
	if profileID == "" {
		return errors.New("profile id is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	items, err := s.LoadProfiles()
	if err != nil {
		return err
	}

	out := make([]Profile, 0, len(items))
	for _, item := range items {
		if item.ID == profileID {
			continue
		}
		out = append(out, item)
	}

	return s.SaveProfiles(out)
}

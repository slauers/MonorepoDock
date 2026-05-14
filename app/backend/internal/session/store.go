package session

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
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
	return &Store{filePath: filepath.Join(baseDir, "runtime-sessions.json")}, nil
}

func (s *Store) GetLast(workspaceRoot string) (RuntimeSession, error) {
	sessions, err := s.listAll()
	if err != nil {
		return RuntimeSession{}, err
	}
	session, ok := sessions[workspaceRoot]
	if !ok {
		return RuntimeSession{WorkspaceRoot: workspaceRoot, Items: []RuntimeSessionItem{}}, nil
	}
	return session, nil
}

func (s *Store) Save(session RuntimeSession) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	all, err := s.readAllUnlocked()
	if err != nil {
		return err
	}
	if session.UpdatedAt.IsZero() {
		session.UpdatedAt = time.Now().UTC()
	}
	all[session.WorkspaceRoot] = session
	return s.writeAllUnlocked(all)
}

func (s *Store) listAll() (map[string]RuntimeSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readAllUnlocked()
}

func (s *Store) readAllUnlocked() (map[string]RuntimeSession, error) {
	raw, err := os.ReadFile(s.filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]RuntimeSession{}, nil
		}
		return nil, err
	}
	var sessions map[string]RuntimeSession
	if err := json.Unmarshal(raw, &sessions); err != nil {
		return nil, err
	}
	if sessions == nil {
		sessions = map[string]RuntimeSession{}
	}
	return sessions, nil
}

func (s *Store) writeAllUnlocked(sessions map[string]RuntimeSession) error {
	payload, err := json.MarshalIndent(sessions, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath, payload, 0o644)
}

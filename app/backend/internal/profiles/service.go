package profiles

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"monodock/backend/internal/runner"
)

type ItemRunner func(item ProfileItem) (runner.Process, error)

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

func (s *Service) ListProfiles() ([]Profile, error) {
	items, err := s.store.ListProfiles()
	if err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})
	return items, nil
}

func (s *Service) SaveProfile(profile Profile) error {
	now := time.Now().UTC()
	profile.Name = strings.TrimSpace(profile.Name)
	if profile.ID == "" {
		profile.ID = generateID("profile")
	}

	if err := validateProfile(profile); err != nil {
		return err
	}

	existing, err := s.store.ListProfiles()
	if err != nil {
		return err
	}

	createdAt := now
	for _, item := range existing {
		if item.ID == profile.ID {
			createdAt = item.CreatedAt
			break
		}
	}

	profile.CreatedAt = createdAt
	profile.UpdatedAt = now
	for i := range profile.Items {
		if profile.Items[i].ID == "" {
			profile.Items[i].ID = generateID("item")
		}
		profile.Items[i].Command = strings.TrimSpace(profile.Items[i].Command)
		profile.Items[i].WorkDir = strings.TrimSpace(profile.Items[i].WorkDir)
		profile.Items[i].Project = strings.TrimSpace(profile.Items[i].Project)
		profile.Items[i].Target = strings.TrimSpace(profile.Items[i].Target)
	}

	return s.store.AddOrUpdateProfile(profile)
}

func (s *Service) DeleteProfile(profileID string) error {
	return s.store.DeleteProfile(strings.TrimSpace(profileID))
}

func (s *Service) RunProfile(profileID string, runItem ItemRunner) ([]runner.Process, error) {
	if runItem == nil {
		return nil, errors.New("profile item runner is required")
	}
	profileID = strings.TrimSpace(profileID)
	if profileID == "" {
		return nil, errors.New("profile id is required")
	}

	profiles, err := s.store.ListProfiles()
	if err != nil {
		return nil, err
	}

	var profile *Profile
	for i := range profiles {
		if profiles[i].ID == profileID {
			profile = &profiles[i]
			break
		}
	}
	if profile == nil {
		return nil, errors.New("profile not found")
	}

	started := make([]runner.Process, 0, len(profile.Items))
	failures := make([]ItemRunError, 0)
	for _, item := range profile.Items {
		proc, runErr := runItem(item)
		if runErr != nil {
			failures = append(failures, ItemRunError{
				ItemID:  item.ID,
				Command: item.Command,
				Message: runErr.Error(),
			})
			continue
		}
		started = append(started, proc)
	}

	if len(failures) > 0 {
		return started, &ProfileRunError{
			ProfileID: profile.ID,
			Failures:  failures,
		}
	}
	return started, nil
}

func validateProfile(profile Profile) error {
	if profile.Name == "" {
		return errors.New("profile name is required")
	}
	if len(profile.Items) == 0 {
		return errors.New("profile must have at least one item")
	}

	for i, item := range profile.Items {
		if strings.TrimSpace(item.Command) == "" {
			return fmt.Errorf("profile item %d command is required", i+1)
		}
		if strings.TrimSpace(item.WorkDir) == "" {
			return fmt.Errorf("profile item %d workDir is required", i+1)
		}
	}
	return nil
}

func generateID(prefix string) string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(buf)
}

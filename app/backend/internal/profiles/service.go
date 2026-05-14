package profiles

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"monodock/backend/internal/runner"
)

type ItemRunner func(item ProfileItem) (runner.Process, error)

type Service struct {
	store      *Store
	mu         sync.RWMutex
	profileRun map[string][]string
	processMap map[string]string
}

func NewService(baseDir string) (*Service, error) {
	store, err := NewStore(baseDir)
	if err != nil {
		return nil, err
	}
	return &Service{
		store:      store,
		profileRun: make(map[string][]string),
		processMap: make(map[string]string),
	}, nil
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
	profileID = strings.TrimSpace(profileID)
	if err := s.store.DeleteProfile(profileID); err != nil {
		return err
	}
	s.mu.Lock()
	delete(s.profileRun, profileID)
	for procID, trackedProfileID := range s.processMap {
		if trackedProfileID == profileID {
			delete(s.processMap, procID)
		}
	}
	s.mu.Unlock()
	return nil
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
	s.trackProcesses(profile.ID, started)

	if len(failures) > 0 {
		return started, &ProfileRunError{
			ProfileID: profile.ID,
			Failures:  failures,
		}
	}
	return started, nil
}

func (s *Service) StopProfile(profileID string, stopProcess func(processID string) error) error {
	if stopProcess == nil {
		return errors.New("stop process callback is required")
	}
	profileID = strings.TrimSpace(profileID)
	if profileID == "" {
		return errors.New("profile id is required")
	}

	processIDs := s.getTrackedProcessIDs(profileID)
	if len(processIDs) == 0 {
		return nil
	}

	var failed []string
	for _, processID := range processIDs {
		if err := stopProcess(processID); err != nil && !strings.Contains(strings.ToLower(err.Error()), "not found") {
			failed = append(failed, processID)
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("failed to stop %d process(es) for profile %s", len(failed), profileID)
	}
	return nil
}

func (s *Service) GetProfileRuntimeState(profileID string, processes []runner.Process) ProfileRuntimeState {
	profileID = strings.TrimSpace(profileID)
	if profileID == "" {
		return ProfileRuntimeState{Status: "idle"}
	}
	tracked := s.getTrackedProcessIDs(profileID)
	return buildRuntimeState(profileID, tracked, processes)
}

func (s *Service) ListProfileRuntimeStates(processes []runner.Process) []ProfileRuntimeState {
	s.mu.RLock()
	keys := make([]string, 0, len(s.profileRun))
	for profileID := range s.profileRun {
		keys = append(keys, profileID)
	}
	s.mu.RUnlock()
	sort.Strings(keys)

	out := make([]ProfileRuntimeState, 0, len(keys))
	for _, profileID := range keys {
		tracked := s.getTrackedProcessIDs(profileID)
		out = append(out, buildRuntimeState(profileID, tracked, processes))
	}
	return out
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

func (s *Service) trackProcesses(profileID string, started []runner.Process) {
	if strings.TrimSpace(profileID) == "" || len(started) == 0 {
		return
	}

	next := make([]string, 0, len(started))
	seen := make(map[string]struct{}, len(started))
	for _, proc := range started {
		if proc.ID == "" {
			continue
		}
		if _, exists := seen[proc.ID]; exists {
			continue
		}
		seen[proc.ID] = struct{}{}
		next = append(next, proc.ID)
	}

	s.mu.Lock()
	s.profileRun[profileID] = next
	for _, procID := range next {
		s.processMap[procID] = profileID
	}
	s.mu.Unlock()
}

func (s *Service) ProfileIDByProcess(processID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.processMap[processID]
}

func (s *Service) getTrackedProcessIDs(profileID string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ids := s.profileRun[profileID]
	if len(ids) == 0 {
		return nil
	}
	out := make([]string, len(ids))
	copy(out, ids)
	return out
}

func buildRuntimeState(profileID string, processIDs []string, processes []runner.Process) ProfileRuntimeState {
	state := ProfileRuntimeState{
		ProfileID:  profileID,
		Status:     "idle",
		ProcessIDs: append([]string(nil), processIDs...),
	}
	if len(processIDs) == 0 {
		return state
	}

	byID := make(map[string]runner.Process, len(processes))
	for _, proc := range processes {
		byID[proc.ID] = proc
	}

	for _, processID := range processIDs {
		proc, ok := byID[processID]
		if !ok {
			state.StoppedCount++
			continue
		}
		switch proc.Status {
		case "running", "starting":
			state.RunningCount++
		case "failed":
			state.FailedCount++
		default:
			state.StoppedCount++
		}
	}

	total := len(processIDs)
	switch {
	case state.RunningCount == total:
		state.Status = "running"
	case state.FailedCount == total:
		state.Status = "failed"
	case state.RunningCount == 0 && state.FailedCount == 0:
		state.Status = "stopped"
	case state.RunningCount == 0 && state.FailedCount > 0 && state.StoppedCount == 0:
		state.Status = "failed"
	case state.RunningCount == 0:
		state.Status = "partial"
	default:
		state.Status = "partial"
	}
	return state
}

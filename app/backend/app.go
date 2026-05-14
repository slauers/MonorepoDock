package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"monodock/backend/internal/analyzer"
	"monodock/backend/internal/config"
	"monodock/backend/internal/profiles"
	"monodock/backend/internal/runner"
	"monodock/backend/internal/session"
	"monodock/backend/internal/workspace"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx             context.Context
	workspace       *workspace.Service
	analyzer        *analyzer.Service
	profiles        *profiles.Service
	processes       *runner.Manager
	recentStore     *config.Store
	sessionStore    *session.Store
	activeWorkspace string
	lastSummary     workspace.Summary
}

func NewApp() (*App, error) {
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}

	store, err := config.NewStore(filepath.Join(cfgDir, "monodock"))
	if err != nil {
		return nil, err
	}
	profilesSvc, err := profiles.NewService(filepath.Join(cfgDir, "monodock"))
	if err != nil {
		return nil, err
	}
	sessionStore, err := session.NewStore(filepath.Join(cfgDir, "monodock"))
	if err != nil {
		return nil, err
	}

	return &App{
		workspace:    workspace.NewService(),
		analyzer:     analyzer.NewService(),
		profiles:     profilesSvc,
		processes:    runner.NewManager(),
		recentStore:  store,
		sessionStore: sessionStore,
	}, nil
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) shutdown(ctx context.Context) {
	a.saveWorkspaceRuntimeSession(a.activeWorkspace)
	if a.processes == nil {
		return
	}
	a.processes.StopAll(func(proc runner.Process) {
		runtime.EventsEmit(ctx, "process:updated", proc)
	})
}

func (a *App) OpenWorkspaceDialog() (string, error) {
	if a.ctx == nil {
		return "", errors.New("application context is not ready")
	}

	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Monorepo Workspace",
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}

	if err := a.recentStore.Add(path); err != nil {
		return "", err
	}

	return path, nil
}

func (a *App) InspectWorkspace(root string) (workspace.Summary, error) {
	if a.ctx == nil {
		return workspace.Summary{}, errors.New("application context is not ready")
	}

	root = strings.TrimSpace(root)
	if root == "" {
		return workspace.Summary{}, errors.New("workspace root is required")
	}
	if a.activeWorkspace != "" && a.activeWorkspace != root {
		a.saveWorkspaceRuntimeSession(a.activeWorkspace)
	}

	summary, err := a.workspace.Inspect(a.ctx, root)
	if err != nil {
		return workspace.Summary{}, err
	}
	a.activeWorkspace = root
	a.lastSummary = summary

	_ = a.recentStore.Add(root)
	return summary, nil
}

func (a *App) ListRecentWorkspaces() ([]config.RecentWorkspace, error) {
	return a.recentStore.List()
}

func (a *App) RunCommand(workDir, command string) (runner.Process, error) {
	proc, err := a.processes.Start(
		a.ctx,
		workDir,
		command,
		func(entry runner.LogEntry) {
			runtime.EventsEmit(a.ctx, "process:log", entry)
		},
		func(proc runner.Process) {
			runtime.EventsEmit(a.ctx, "process:updated", proc)
		},
	)
	if err != nil {
		return runner.Process{}, err
	}
	a.saveWorkspaceRuntimeSession(a.activeWorkspace)

	runtime.EventsEmit(a.ctx, "process:started", proc)
	return proc, nil
}

func (a *App) StopCommand(processID string) error {
	if err := a.processes.Stop(processID, func(proc runner.Process) {
		runtime.EventsEmit(a.ctx, "process:updated", proc)
	}); err != nil {
		return err
	}

	runtime.EventsEmit(a.ctx, "process:stopped", processID)
	a.saveWorkspaceRuntimeSession(a.activeWorkspace)
	return nil
}

func (a *App) RestartCommand(processID string) (runner.Process, error) {
	procs := a.processes.List()
	var current runner.Process
	found := false
	for _, proc := range procs {
		if proc.ID == processID {
			current = proc
			found = true
			break
		}
	}
	if !found {
		return runner.Process{}, errors.New("process not found")
	}

	if current.Status == "running" {
		if err := a.StopCommand(processID); err != nil {
			return runner.Process{}, err
		}
	}

	return a.RunCommand(current.WorkDir, current.Command)
}

func (a *App) ListProcesses() []runner.Process {
	return a.processes.List()
}

func (a *App) AnalyzeWorkspace(root string) (analyzer.Report, error) {
	if a.ctx == nil {
		return analyzer.Report{}, errors.New("application context is not ready")
	}
	return a.analyzer.Analyze(a.ctx, root)
}

func (a *App) CloseApp() {
	if a.ctx == nil {
		return
	}
	runtime.Quit(a.ctx)
}

func (a *App) ListProfiles() ([]profiles.Profile, error) {
	return a.profiles.ListProfiles()
}

func (a *App) SaveProfile(profile profiles.Profile) error {
	return a.profiles.SaveProfile(profile)
}

func (a *App) DeleteProfile(profileID string) error {
	return a.profiles.DeleteProfile(profileID)
}

func (a *App) RunProfile(profileID string) ([]runner.Process, error) {
	return a.profiles.RunProfile(profileID, func(item profiles.ProfileItem) (runner.Process, error) {
		return a.RunCommand(item.WorkDir, item.Command)
	})
}

func (a *App) GetLastRuntimeSession(root string) (session.RuntimeSession, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return session.RuntimeSession{}, errors.New("workspace root is required")
	}
	return a.sessionStore.GetLast(root)
}

func (a *App) RestoreRuntimeSession(root string) ([]runner.Process, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil, errors.New("workspace root is required")
	}
	last, err := a.sessionStore.GetLast(root)
	if err != nil {
		return nil, err
	}
	if len(last.Items) == 0 {
		return []runner.Process{}, nil
	}

	started := make([]runner.Process, 0, len(last.Items))
	seenProfiles := map[string]bool{}
	profilesList, _ := a.profiles.ListProfiles()
	existsProfile := map[string]bool{}
	for _, profile := range profilesList {
		existsProfile[profile.ID] = true
	}

	for _, item := range last.Items {
		if item.ProfileID != "" && !seenProfiles[item.ProfileID] && existsProfile[item.ProfileID] {
			seenProfiles[item.ProfileID] = true
			profileProcs, runErr := a.RunProfile(item.ProfileID)
			if runErr == nil {
				started = append(started, profileProcs...)
			}
			continue
		}
		proc, runErr := a.RunCommand(item.WorkDir, item.Command)
		if runErr != nil {
			continue
		}
		started = append(started, proc)
	}
	a.saveWorkspaceRuntimeSession(root)
	return started, nil
}

func (a *App) GetProfileRuntimeState(profileID string) profiles.ProfileRuntimeState {
	return a.profiles.GetProfileRuntimeState(profileID, a.processes.List())
}

func (a *App) ListProfileRuntimeStates() []profiles.ProfileRuntimeState {
	return a.profiles.ListProfileRuntimeStates(a.processes.List())
}

func (a *App) StopProfile(profileID string) error {
	return a.profiles.StopProfile(profileID, func(processID string) error {
		return a.StopCommand(processID)
	})
}

func (a *App) saveWorkspaceRuntimeSession(root string) {
	if a.sessionStore == nil {
		return
	}
	root = strings.TrimSpace(root)
	if root == "" {
		return
	}

	items := make([]session.RuntimeSessionItem, 0)
	seen := map[string]bool{}
	for _, proc := range a.processes.List() {
		if proc.Status != "running" && proc.Status != "starting" {
			continue
		}
		if !isPathWithinRoot(root, proc.WorkDir) {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(proc.WorkDir)) + "::" + strings.TrimSpace(proc.Command)
		if seen[key] {
			continue
		}
		seen[key] = true
		project, target := a.resolveProjectAndTarget(proc.WorkDir, proc.Command)
		items = append(items, session.RuntimeSessionItem{
			ProcessID: proc.ID,
			Command:   proc.Command,
			WorkDir:   proc.WorkDir,
			Project:   project,
			Target:    target,
			ProfileID: a.profiles.ProfileIDByProcess(proc.ID),
		})
	}

	_ = a.sessionStore.Save(session.RuntimeSession{
		WorkspaceRoot: root,
		UpdatedAt:     time.Now().UTC(),
		Items:         items,
	})
}

func (a *App) resolveProjectAndTarget(workDir string, command string) (string, string) {
	for _, project := range a.lastSummary.Projects {
		for _, target := range project.Targets {
			if target.WorkDir == workDir && target.Command == command {
				return project.Name, target.Name
			}
		}
	}
	return "", ""
}

func isPathWithinRoot(root, path string) bool {
	root = strings.TrimSpace(root)
	path = strings.TrimSpace(path)
	if root == "" || path == "" {
		return false
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absRoot, absPath)
	if err != nil {
		return false
	}
	rel = filepath.Clean(rel)
	return rel == "." || (!strings.HasPrefix(rel, "..") && rel != "..")
}

package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"monodock/backend/internal/analyzer"
	"monodock/backend/internal/config"
	"monodock/backend/internal/runner"
	"monodock/backend/internal/workspace"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx         context.Context
	workspace   *workspace.Service
	analyzer    *analyzer.Service
	processes   *runner.Manager
	recentStore *config.Store
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

	return &App{
		workspace:   workspace.NewService(),
		analyzer:    analyzer.NewService(),
		processes:   runner.NewManager(),
		recentStore: store,
	}, nil
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) shutdown(ctx context.Context) {
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

	summary, err := a.workspace.Inspect(a.ctx, root)
	if err != nil {
		return workspace.Summary{}, err
	}

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

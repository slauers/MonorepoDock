package runner

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"

	"monodock/backend/internal/cmdutil"
)

type Process struct {
	ID           string     `json:"id"`
	Command      string     `json:"command"`
	WorkDir      string     `json:"workDir"`
	StartedAt    time.Time  `json:"startedAt"`
	StoppedAt    *time.Time `json:"stoppedAt,omitempty"`
	ExitCode     *int       `json:"exitCode,omitempty"`
	RestartCount int        `json:"restartCount"`
	LastOutputAt *time.Time `json:"lastOutputAt,omitempty"`
	HealthStatus string     `json:"healthStatus"`
	Status       string     `json:"status"`
}

type LogEntry struct {
	ProcessID string    `json:"processId"`
	Stream    string    `json:"stream"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
}

type Manager struct {
	mu        sync.RWMutex
	processes map[string]*managedProcess
}

type managedProcess struct {
	meta   Process
	cancel context.CancelFunc
}

const silentThreshold = 5 * time.Minute

func NewManager() *Manager {
	return &Manager{
		processes: make(map[string]*managedProcess),
	}
}

func (m *Manager) Start(
	parent context.Context,
	workDir string,
	command string,
	onLog func(LogEntry),
	onStateChange func(Process),
) (Process, error) {
	if strings.TrimSpace(workDir) == "" {
		return Process{}, errors.New("work dir is required")
	}
	if strings.TrimSpace(command) == "" {
		return Process{}, errors.New("command is required")
	}

	procID := fmt.Sprintf("proc-%d", time.Now().UnixNano())
	ctx, cancel := context.WithCancel(parent)
	meta := Process{
		ID:           procID,
		Command:      command,
		WorkDir:      workDir,
		StartedAt:    time.Now().UTC(),
		RestartCount: m.nextRestartCount(workDir, command),
		Status:       "starting",
	}
	meta.HealthStatus = computeHealth(meta, time.Now().UTC())

	m.mu.Lock()
	m.processes[procID] = &managedProcess{meta: meta, cancel: cancel}
	m.mu.Unlock()

	if onStateChange != nil {
		onStateChange(meta)
	}

	cmd := cmdutil.CommandContext(ctx, command)
	cmdutil.ConfigureForBackground(cmd)
	cmd.Dir = workDir

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		m.updateStatus(procID, "failed", onStateChange)
		return Process{}, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		m.updateStatus(procID, "failed", onStateChange)
		return Process{}, err
	}

	if err := cmd.Start(); err != nil {
		cancel()
		m.updateStatus(procID, "failed", onStateChange)
		return Process{}, err
	}

	m.updateStatus(procID, "running", onStateChange)

	go m.streamLogs(procID, "stdout", stdout, onLog, onStateChange)
	go m.streamLogs(procID, "stderr", stderr, onLog, onStateChange)
	go m.wait(cmd, procID, onLog, onStateChange)

	return meta, nil
}

func (m *Manager) Stop(processID string, onStateChange func(Process)) error {
	m.mu.RLock()
	proc, ok := m.processes[processID]
	m.mu.RUnlock()
	if !ok {
		return errors.New("process not found")
	}

	proc.cancel()

	m.mu.Lock()
	proc.meta.Status = "stopped"
	now := time.Now().UTC()
	proc.meta.StoppedAt = &now
	proc.meta.HealthStatus = computeHealth(proc.meta, now)
	m.processes[processID] = proc
	m.mu.Unlock()

	if onStateChange != nil {
		onStateChange(proc.meta)
	}

	return nil
}

func (m *Manager) List() []Process {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]Process, 0, len(m.processes))
	for _, proc := range m.processes {
		proc.meta.HealthStatus = computeHealth(proc.meta, time.Now().UTC())
		out = append(out, proc.meta)
	}
	return out
}

func (m *Manager) StopAll(onStateChange func(Process)) {
	m.mu.RLock()
	ids := make([]string, 0, len(m.processes))
	for id := range m.processes {
		ids = append(ids, id)
	}
	m.mu.RUnlock()

	for _, id := range ids {
		_ = m.Stop(id, onStateChange)
	}
}

func (m *Manager) wait(cmd *exec.Cmd, processID string, onLog func(LogEntry), onStateChange func(Process)) {
	waitErr := cmd.Wait()

	m.mu.Lock()
	defer m.mu.Unlock()

	proc, ok := m.processes[processID]
	if !ok {
		return
	}
	if proc.meta.Status == "running" || proc.meta.Status == "starting" {
		if waitErr != nil {
			proc.meta.Status = "failed"
			if exitErr, ok := waitErr.(*exec.ExitError); ok {
				code := exitErr.ExitCode()
				proc.meta.ExitCode = &code
			}
		} else {
			proc.meta.Status = "exited"
			code := 0
			proc.meta.ExitCode = &code
		}
	}
	now := time.Now().UTC()
	proc.meta.StoppedAt = &now
	proc.meta.HealthStatus = computeHealth(proc.meta, now)
	m.processes[processID] = proc

	if onStateChange != nil {
		onStateChange(proc.meta)
	}

	if onLog != nil {
		onLog(LogEntry{
			ProcessID: processID,
			Stream:    "system",
			Message:   finishMessage(proc.meta.Status),
			Timestamp: time.Now().UTC(),
		})
	}
}

func (m *Manager) streamLogs(processID, stream string, reader io.Reader, onLog func(LogEntry), onStateChange func(Process)) {
	if onLog == nil {
		return
	}

	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		now := time.Now().UTC()
		m.touchOutput(processID, now, onStateChange)
		onLog(LogEntry{
			ProcessID: processID,
			Stream:    stream,
			Message:   scanner.Text(),
			Timestamp: now,
		})
	}
}

func (m *Manager) updateStatus(processID, status string, onStateChange func(Process)) {
	m.mu.Lock()
	proc, ok := m.processes[processID]
	if !ok {
		m.mu.Unlock()
		return
	}
	proc.meta.Status = status
	proc.meta.HealthStatus = computeHealth(proc.meta, time.Now().UTC())
	updated := proc.meta
	m.processes[processID] = proc
	m.mu.Unlock()

	if onStateChange != nil {
		onStateChange(updated)
	}
}

func (m *Manager) touchOutput(processID string, at time.Time, onStateChange func(Process)) {
	m.mu.Lock()
	proc, ok := m.processes[processID]
	if !ok {
		m.mu.Unlock()
		return
	}
	proc.meta.LastOutputAt = &at
	proc.meta.HealthStatus = computeHealth(proc.meta, at)
	updated := proc.meta
	m.processes[processID] = proc
	m.mu.Unlock()
	if onStateChange != nil {
		onStateChange(updated)
	}
}

func (m *Manager) nextRestartCount(workDir, command string) int {
	maxCount := 0
	for _, proc := range m.processes {
		if proc.meta.WorkDir == workDir && proc.meta.Command == command && proc.meta.RestartCount >= maxCount {
			maxCount = proc.meta.RestartCount + 1
		}
	}
	return maxCount
}

func computeHealth(meta Process, now time.Time) string {
	switch meta.Status {
	case "failed":
		return "failed"
	case "exited", "stopped":
		if meta.ExitCode != nil && *meta.ExitCode != 0 {
			return "failed"
		}
		return "stopped"
	case "running", "starting":
		base := meta.StartedAt
		if meta.LastOutputAt != nil {
			base = *meta.LastOutputAt
		}
		if now.Sub(base) > silentThreshold {
			return "warning"
		}
		return "running"
	default:
		return "idle"
	}
}

func finishMessage(status string) string {
	switch status {
	case "failed":
		return "process failed"
	case "stopped":
		return "process stopped"
	default:
		return "process finished"
	}
}

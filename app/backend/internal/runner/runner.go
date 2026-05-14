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
	ID        string    `json:"id"`
	Command   string    `json:"command"`
	WorkDir   string    `json:"workDir"`
	StartedAt time.Time `json:"startedAt"`
	Status    string    `json:"status"`
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
		ID:        procID,
		Command:   command,
		WorkDir:   workDir,
		StartedAt: time.Now().UTC(),
		Status:    "starting",
	}

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

	go m.streamLogs(procID, "stdout", stdout, onLog)
	go m.streamLogs(procID, "stderr", stderr, onLog)
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
		} else {
			proc.meta.Status = "exited"
		}
	}
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

func (m *Manager) streamLogs(processID, stream string, reader io.Reader, onLog func(LogEntry)) {
	if onLog == nil {
		return
	}

	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		onLog(LogEntry{
			ProcessID: processID,
			Stream:    stream,
			Message:   scanner.Text(),
			Timestamp: time.Now().UTC(),
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
	updated := proc.meta
	m.processes[processID] = proc
	m.mu.Unlock()

	if onStateChange != nil {
		onStateChange(updated)
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

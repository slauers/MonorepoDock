//go:build windows

package ports

import (
	"context"
	"encoding/csv"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"monodock/backend/internal/cmdutil"
)

func findPortConflicts(ctx context.Context, workDir string, port int) ([]Conflict, error) {
	if distro, linuxPath, user, ok := wslPathInfo(workDir); ok {
		return findWSLPortConflicts(ctx, distro, user, linuxPath, port)
	}
	return findWindowsPortConflicts(ctx, port)
}

func stopPortProcess(ctx context.Context, workDir string, pid int) error {
	if distro, _, user, ok := wslPathInfo(workDir); ok {
		args := []string{"-d", distro}
		if user != "" {
			args = append(args, "-u", user)
		}
		args = append(args, "bash", "-lc", "kill -TERM "+strconv.Itoa(pid))
		cmd := exec.CommandContext(ctx, "wsl.exe", args...)
		cmdutil.ConfigureForBackground(cmd)
		return cmd.Run()
	}
	cmd := exec.CommandContext(ctx, "taskkill", "/PID", strconv.Itoa(pid), "/T", "/F")
	cmdutil.ConfigureForBackground(cmd)
	return cmd.Run()
}

func findWindowsPortConflicts(ctx context.Context, port int) ([]Conflict, error) {
	cmd := exec.CommandContext(ctx, "netstat", "-ano", "-p", "tcp")
	cmdutil.ConfigureForBackground(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	pidByPort := map[int]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		if !strings.EqualFold(fields[3], "LISTENING") {
			continue
		}
		local := fields[1]
		if !strings.HasSuffix(local, ":"+strconv.Itoa(port)) {
			continue
		}
		pid, err := strconv.Atoi(fields[len(fields)-1])
		if err == nil {
			pidByPort[pid] = true
		}
	}
	conflicts := []Conflict{}
	for pid := range pidByPort {
		conflicts = append(conflicts, Conflict{
			Port:    port,
			PID:     pid,
			Command: windowsProcessName(ctx, pid),
		})
	}
	return conflicts, nil
}

func windowsProcessName(ctx context.Context, pid int) string {
	cmd := exec.CommandContext(ctx, "tasklist", "/FI", "PID eq "+strconv.Itoa(pid), "/FO", "CSV", "/NH")
	cmdutil.ConfigureForBackground(cmd)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	reader := csv.NewReader(strings.NewReader(string(out)))
	rows, err := reader.ReadAll()
	if err != nil || len(rows) == 0 || len(rows[0]) == 0 {
		return ""
	}
	if strings.Contains(rows[0][0], "No tasks") {
		return ""
	}
	return rows[0][0]
}

func findWSLPortConflicts(ctx context.Context, distro, user, _ string, port int) ([]Conflict, error) {
	script := `
port="$1"
if command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2 "|" $1; exit}'
  exit 0
fi
if command -v fuser >/dev/null 2>&1; then
  for pid in $(fuser -n tcp "$port" 2>/dev/null); do
    cmd=$(ps -p "$pid" -o comm= 2>/dev/null | head -n1)
    echo "$pid|$cmd"
    exit 0
  done
fi
if command -v ss >/dev/null 2>&1; then
  line=$(ss -H -ltnp 2>/dev/null | grep -E "[:.]$port\\b" | head -n1)
  pid=$(printf '%s' "$line" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p')
  if [ -n "$pid" ]; then
    cmd=$(ps -p "$pid" -o comm= 2>/dev/null | head -n1)
    echo "$pid|$cmd"
  fi
fi
`
	args := []string{"-d", distro}
	if user != "" {
		args = append(args, "-u", user)
	}
	args = append(args, "bash", "-lc", script, "sh", strconv.Itoa(port))
	cmd := exec.CommandContext(ctx, "wsl.exe", args...)
	cmdutil.ConfigureForBackground(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	return parsePIDCommandLines(port, string(out)), nil
}

func parsePIDCommandLines(port int, raw string) []Conflict {
	conflicts := []Conflict{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 2)
		pid, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil {
			continue
		}
		command := ""
		if len(parts) > 1 {
			command = strings.TrimSpace(parts[1])
		}
		conflicts = append(conflicts, Conflict{Port: port, PID: pid, Command: command})
	}
	return conflicts
}

func wslPathInfo(workDir string) (distro, linuxPath, user string, ok bool) {
	if workDir == "" {
		return "", "", "", false
	}
	normalized := strings.ReplaceAll(workDir, "/", `\`)
	lower := strings.ToLower(normalized)
	const prefixA = `\\wsl.localhost\`
	const prefixB = `\\wsl$\`
	var rest string
	switch {
	case strings.HasPrefix(lower, prefixA):
		rest = normalized[len(prefixA):]
	case strings.HasPrefix(lower, prefixB):
		rest = normalized[len(prefixB):]
	default:
		return "", "", "", false
	}
	parts := strings.SplitN(rest, `\`, 2)
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		return "", "", "", false
	}
	distro = parts[0]
	if len(parts) == 1 || parts[1] == "" {
		return distro, "/", "", true
	}
	linuxPath = "/" + strings.ReplaceAll(parts[1], `\`, "/")
	user = userFromLinuxPath(linuxPath)
	return distro, linuxPath, user, true
}

var linuxHomePattern = regexp.MustCompile(`^/home/([^/]+)(?:/|$)`)

func userFromLinuxPath(linuxPath string) string {
	match := linuxHomePattern.FindStringSubmatch(linuxPath)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}

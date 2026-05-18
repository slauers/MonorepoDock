//go:build !windows

package ports

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
)

func findPortConflicts(ctx context.Context, _ string, port int) ([]Conflict, error) {
	return findPortConflictsWithShell(ctx, port)
}

func stopPortProcess(ctx context.Context, _ string, pid int) error {
	return exec.CommandContext(ctx, "kill", "-TERM", strconv.Itoa(pid)).Run()
}

func findPortConflictsWithShell(ctx context.Context, port int) ([]Conflict, error) {
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
	out, err := exec.CommandContext(ctx, "sh", "-lc", script, "sh", strconv.Itoa(port)).Output()
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

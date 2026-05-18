//go:build windows

package cmdutil

import (
	"context"
	"os/exec"
	"strings"
)

// CommandContext runs commands through cmd.exe to avoid PowerShell execution-policy
// issues with wrappers like npm.ps1.
func CommandContext(ctx context.Context, workDir string, command string) *exec.Cmd {
	trimmed := strings.TrimSpace(workDir)
	if distro, linuxPath, ok := toWSLPath(trimmed); ok {
		command = rewriteWSLCommand(command)
		escapedPath := strings.ReplaceAll(linuxPath, `'`, `'\''`)
		wrapped := strings.Join([]string{
			`__MD_PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -vF '/mnt/c/Program Files/nodejs' | paste -sd ':' - || true)"`,
			`if [ -n "$__MD_PATH" ]; then PATH="$__MD_PATH"; fi`,
			`__MD_PATH2="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '/mnt/c/.*/AppData/Roaming/npm' | paste -sd ':' - || true)"`,
			`if [ -n "$__MD_PATH2" ]; then PATH="$__MD_PATH2"; fi`,
			`export npm_config_cache="$HOME/.npm"`,
			`export NPM_CONFIG_CACHE="$HOME/.npm"`,
			`export npm_config_userconfig="/dev/null"`,
			`export NPM_CONFIG_USERCONFIG="/dev/null"`,
			`export npm_config_globalconfig="/dev/null"`,
			`export NPM_CONFIG_GLOBALCONFIG="/dev/null"`,
			`unset npm_config_prefix npm_config_local_prefix`,
			`unset NPM_CONFIG_PREFIX NPM_CONFIG_LOCAL_PREFIX`,
			`unset PREFIX NODE_PATH`,
			`if ! command -v node >/dev/null 2>&1; then echo "node runtime not found in WSL PATH" 1>&2; echo "debug: user=$(id -un) home=$HOME" 1>&2; echo "debug: path=$PATH" 1>&2; exit 127; fi`,
			"cd '" + escapedPath + "'",
			command,
		}, " && ")
		args := []string{"-d", distro}
		if wslUser := userFromWSLPath(linuxPath); wslUser != "" {
			args = append(args, "-u", wslUser)
		}
		args = append(args, "bash", "-lic", wrapped)
		return exec.CommandContext(ctx, "wsl.exe", args...)
	}
	return exec.CommandContext(ctx, "cmd.exe", "/d", "/s", "/c", command)
}

func rewriteWSLCommand(command string) string {
	fields := strings.Fields(strings.TrimSpace(command))
	if len(fields) == 0 {
		return command
	}

	normalizedHead := strings.ToLower(fields[0])
	if normalizedHead == "./node_modules/.bin/nx" || normalizedHead == "node_modules/.bin/nx" {
		return command
	}

	if len(fields) >= 2 && fields[0] == "npx" {
		tool := fields[1]
		rest := strings.Join(fields[2:], " ")
		if tool == "nx" {
			if rest == "" {
				return `./node_modules/.bin/nx`
			}
			return `./node_modules/.bin/nx ` + rest
		}
		local := "./node_modules/.bin/" + tool
		if rest == "" {
			return local
		}
		return local + " " + rest
	}
	return command
}

func ShouldSetCommandDir(workDir string) bool {
	_, _, ok := toWSLPath(strings.TrimSpace(workDir))
	return !ok
}

func toWSLPath(workDir string) (distro string, linuxPath string, ok bool) {
	if workDir == "" {
		return "", "", false
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
		return "", "", false
	}
	parts := strings.SplitN(rest, `\`, 2)
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		return "", "", false
	}
	distro = parts[0]
	if len(parts) == 1 || parts[1] == "" {
		return distro, "/", true
	}
	linuxPath = "/" + strings.ReplaceAll(parts[1], `\`, "/")
	return distro, linuxPath, true
}

func userFromWSLPath(linuxPath string) string {
	const homePrefix = "/home/"
	if !strings.HasPrefix(linuxPath, homePrefix) {
		return ""
	}
	rest := strings.TrimPrefix(linuxPath, homePrefix)
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

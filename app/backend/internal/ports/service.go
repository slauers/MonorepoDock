package ports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type Service struct{}

func NewService() *Service {
	return &Service{}
}

type packageJSON struct {
	Scripts         map[string]string `json:"scripts"`
	Dependencies    map[string]string `json:"dependencies"`
	DevDependencies map[string]string `json:"devDependencies"`
}

func (s *Service) Check(ctx context.Context, workDir, command string) (Report, error) {
	workDir = strings.TrimSpace(workDir)
	command = strings.TrimSpace(command)
	if workDir == "" {
		return Report{}, errors.New("work dir is required")
	}
	if command == "" {
		return Report{}, errors.New("command is required")
	}

	candidates := inferPortCandidates(workDir, command)
	report := Report{
		WorkDir: workDir,
		Command: command,
		Ports:   candidates,
		Message: "No port candidates detected",
	}
	if len(candidates) == 0 {
		return report, nil
	}

	seenConflicts := map[string]bool{}
	for _, candidate := range candidates {
		conflicts, err := findPortConflicts(ctx, workDir, candidate.Port)
		if err != nil {
			continue
		}
		for _, conflict := range conflicts {
			key := fmt.Sprintf("%d:%d", conflict.Port, conflict.PID)
			if seenConflicts[key] {
				continue
			}
			seenConflicts[key] = true
			report.Conflicts = append(report.Conflicts, conflict)
		}
	}
	if len(report.Conflicts) > 0 {
		report.SuggestedPort = s.SuggestAvailablePort(ctx, workDir, report.Conflicts[0].Port)
		report.Message = "Port conflict detected"
	} else {
		report.Message = "No port conflicts detected"
	}
	return report, nil
}

func (s *Service) SuggesteAvailablePort(ctx context.Context, workDir string, fromPort int) int {
	return s.SuggestAvailablePort(ctx, workDir, fromPort)
}

func (s *Service) SuggestAvailablePort(ctx context.Context, workDir string, fromPort int) int {
	if fromPort <= 0 {
		fromPort = 3000
	}
	for port := fromPort + 1; port < fromPort+200; port++ {
		conflicts, err := findPortConflicts(ctx, workDir, port)
		if err != nil {
			continue
		}
		if len(conflicts) == 0 {
			return port
		}
	}
	return fromPort + 1
}

func (s *Service) CommandWithPort(workDir, command string, port int) (string, error) {
	if port <= 0 || port > 65535 {
		return "", errors.New("port must be between 1 and 65535")
	}
	return commandWithPort(workDir, command, port), nil
}

func (s *Service) StopPortProcess(ctx context.Context, workDir string, pid int) error {
	if pid <= 0 {
		return errors.New("pid is required")
	}
	return stopPortProcess(ctx, workDir, pid)
}

func inferPortCandidates(workDir, command string) []Candidate {
	candidates := []Candidate{}
	add := func(port int, source string) {
		if port <= 0 || port > 65535 {
			return
		}
		for _, existing := range candidates {
			if existing.Port == port {
				return
			}
		}
		candidates = append(candidates, Candidate{Port: port, Source: source})
	}

	for _, port := range explicitPorts(command) {
		add(port, "command")
	}

	pkg, scriptName := loadPackageScript(workDir, command)
	if scriptName != "" && pkg.Scripts != nil {
		if script, ok := pkg.Scripts[scriptName]; ok {
			for _, port := range explicitPorts(script) {
				add(port, "package script")
			}
		}
	}

	for _, port := range configPorts(workDir, command) {
		add(port, "config")
	}

	for _, port := range defaultPorts(workDir, command, scriptName, pkg) {
		add(port, "default")
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Port < candidates[j].Port
	})
	return candidates
}

var (
	flagPortPattern   = regexp.MustCompile(`(?i)(?:^|\s)(?:--port|--listen-port|--server\.port|--http-port|--https-port)(?:=|\s+)([0-9]{2,5})\b`)
	envPortPattern    = regexp.MustCompile(`(?i)(?:^|\s)(?:PORT|HTTP_PORT|HTTPS_PORT|SERVER_PORT|APP_PORT|VITE_PORT|NEXT_PORT|ASPNETCORE_HTTP_PORTS)=([0-9]{2,5})\b`)
	urlPortPattern    = regexp.MustCompile(`(?i)(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):([0-9]{2,5})\b`)
	configPortPattern = regexp.MustCompile(`(?i)(?:"port"|port)\s*[:=]\s*([0-9]{2,5})\b`)
)

func explicitPorts(text string) []int {
	out := []int{}
	for _, pattern := range []*regexp.Regexp{flagPortPattern, envPortPattern, urlPortPattern} {
		for _, match := range pattern.FindAllStringSubmatch(text, -1) {
			if len(match) < 2 {
				continue
			}
			if port, err := strconv.Atoi(match[1]); err == nil {
				out = append(out, port)
			}
		}
	}
	return out
}

func loadPackageScript(workDir, command string) (packageJSON, string) {
	scriptName := scriptNameFromCommand(command)
	if scriptName == "" {
		return packageJSON{}, ""
	}
	pkg, ok := readPackageJSON(workDir)
	if !ok {
		return packageJSON{}, scriptName
	}
	return pkg, scriptName
}

func scriptNameFromCommand(command string) string {
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return ""
	}
	if len(fields) >= 3 && fields[0] == "npm" && (fields[1] == "run" || fields[1] == "run-script") {
		return fields[2]
	}
	if len(fields) >= 3 && fields[0] == "bun" && fields[1] == "run" {
		return fields[2]
	}
	if len(fields) >= 3 && fields[0] == "pnpm" && fields[1] == "run" {
		return fields[2]
	}
	if len(fields) >= 2 && (fields[0] == "pnpm" || fields[0] == "yarn" || fields[0] == "bun") {
		return fields[1]
	}
	return ""
}

func readPackageJSON(workDir string) (packageJSON, bool) {
	raw, err := os.ReadFile(filepath.Join(workDir, "package.json"))
	if err != nil {
		return packageJSON{}, false
	}
	var pkg packageJSON
	if err := json.Unmarshal(raw, &pkg); err != nil {
		return packageJSON{}, false
	}
	return pkg, true
}

func configPorts(workDir, command string) []int {
	out := []int{}
	files := []string{
		"vite.config.ts",
		"vite.config.js",
		"vite.config.mjs",
		"vite.config.cjs",
		"angular.json",
		"project.json",
		"Properties/launchSettings.json",
	}
	if nxProject, _, ok := parseNxCommand(command); ok {
		root := findNxProjectRoot(workDir, nxProject)
		if root != "" && root != workDir {
			files = append(files, filepath.Join(root, "project.json"))
			files = append(files, filepath.Join(root, "vite.config.ts"))
			files = append(files, filepath.Join(root, "vite.config.js"))
		}
	}
	for _, file := range files {
		raw, err := os.ReadFile(filepath.Join(workDir, file))
		if err != nil {
			continue
		}
		for _, match := range configPortPattern.FindAllStringSubmatch(string(raw), -1) {
			if len(match) < 2 {
				continue
			}
			if port, err := strconv.Atoi(match[1]); err == nil {
				out = append(out, port)
			}
		}
	}
	return out
}

func defaultPorts(workDir, command, scriptName string, pkg packageJSON) []int {
	text := strings.ToLower(command + " " + scriptName)
	out := []int{}
	hasDep := func(name string) bool {
		_, dep := pkg.Dependencies[name]
		_, dev := pkg.DevDependencies[name]
		return dep || dev
	}
	if strings.Contains(text, ":dev") || strings.Contains(text, ":serve") || scriptName == "dev" || scriptName == "serve" || scriptName == "start" {
		if hasDep("vite") {
			out = append(out, 5173)
		}
		if hasDep("next") || hasDep("react-scripts") || hasDep("@nestjs/core") || hasDep("nuxt") {
			out = append(out, 3000)
		}
		if hasDep("@angular/core") || strings.Contains(text, "ng serve") {
			out = append(out, 4200)
		}
		if hasDep("astro") {
			out = append(out, 4321)
		}
		if strings.Contains(text, "nx run") && (strings.Contains(text, ":dev") || strings.Contains(text, ":serve")) {
			out = append(out, 4200)
		}
	}
	if strings.Contains(strings.ToLower(command), "docker compose") {
		out = append(out, dockerComposePorts(workDir)...)
	}
	return out
}

func dockerComposePorts(workDir string) []int {
	out := []int{}
	for _, file := range []string{"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"} {
		raw, err := os.ReadFile(filepath.Join(workDir, file))
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(raw), "\n") {
			line = strings.TrimSpace(strings.Trim(line, `"'`))
			if strings.HasPrefix(line, "-") {
				line = strings.TrimSpace(strings.TrimPrefix(line, "-"))
			}
			parts := strings.Split(line, ":")
			if len(parts) < 2 {
				continue
			}
			port, err := strconv.Atoi(strings.TrimSpace(strings.Trim(parts[0], `"'`)))
			if err == nil {
				out = append(out, port)
			}
		}
		break
	}
	return out
}

func parseNxCommand(command string) (project string, target string, ok bool) {
	fields := strings.Fields(command)
	for i := 0; i < len(fields)-1; i++ {
		if fields[i] == "run" && strings.Contains(fields[i+1], ":") {
			parts := strings.SplitN(fields[i+1], ":", 2)
			return parts[0], parts[1], true
		}
	}
	return "", "", false
}

func findNxProjectRoot(root, projectName string) string {
	var found string
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || found != "" {
			return nil
		}
		if d.IsDir() {
			base := d.Name()
			if base == "node_modules" || base == ".git" || base == "dist" || base == "build" {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Name() != "project.json" {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		var doc struct {
			Name string `json:"name"`
		}
		if json.Unmarshal(raw, &doc) == nil && doc.Name == projectName {
			found = filepath.Dir(path)
		}
		return nil
	})
	return found
}

func commandWithPort(workDir, command string, port int) string {
	portText := strconv.Itoa(port)
	if flagPortPattern.MatchString(command) {
		return flagPortPattern.ReplaceAllString(command, ` --port `+portText)
	}
	if envPortPattern.MatchString(command) {
		return envPortPattern.ReplaceAllString(command, ` PORT=`+portText)
	}
	fields := strings.Fields(command)
	if len(fields) >= 2 && fields[0] == "npx" && fields[1] == "nx" {
		return command + " --port=" + portText
	}
	if len(fields) >= 2 && (fields[0] == "nx" || strings.HasSuffix(fields[0], "/nx") || strings.HasSuffix(fields[0], `\nx`)) {
		return command + " --port=" + portText
	}
	if scriptNameFromCommand(command) != "" {
		switch fields[0] {
		case "npm", "pnpm", "bun":
			return command + " -- --port " + portText
		case "yarn":
			return command + " --port " + portText
		}
	}
	if isWindowsLocalPath(workDir) {
		return "set PORT=" + portText + "&& " + command
	}
	return "PORT=" + portText + " " + command
}

func isWindowsLocalPath(path string) bool {
	return len(path) >= 2 && path[1] == ':' && !strings.HasPrefix(path, `\\`)
}

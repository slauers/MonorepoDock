package analyzer

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Service struct{}

func NewService() *Service {
	return &Service{}
}

type packageJSON struct {
	Name            string            `json:"name"`
	Dependencies    map[string]string `json:"dependencies"`
	DevDependencies map[string]string `json:"devDependencies"`
}

type depUse struct {
	projectPath string
	version     string
}

func (s *Service) Analyze(ctx context.Context, root string) (Report, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return Report{}, err
	}

	depMap := map[string][]depUse{}
	rootDeps := map[string]string{}
	findings := make([]Finding, 0)

	err = filepath.WalkDir(absRoot, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			base := d.Name()
			if base == "node_modules" || base == ".git" || base == "dist" || base == "build" {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Name() != "package.json" {
			return nil
		}

		raw, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		var doc packageJSON
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil
		}
		projectDir := filepath.Dir(path)
		rel, err := filepath.Rel(absRoot, projectDir)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			rel = "/"
		}

		if rel == "/" {
			for name, version := range doc.Dependencies {
				rootDeps[name] = version
			}
			for name, version := range doc.DevDependencies {
				rootDeps[name] = version
			}
		}

		for name, version := range doc.Dependencies {
			depMap[name] = append(depMap[name], depUse{projectPath: rel, version: version})
		}
		for name, version := range doc.DevDependencies {
			depMap[name] = append(depMap[name], depUse{projectPath: rel, version: version})
		}

		return nil
	})
	if err != nil {
		return Report{}, err
	}

	for name, uses := range depMap {
		if len(uses) < 2 {
			continue
		}
		versions := map[string]bool{}
		projects := map[string]bool{}
		for _, use := range uses {
			versions[use.version] = true
			if use.projectPath != "/" {
				projects[use.projectPath] = true
			}
		}

		if len(versions) > 1 {
			list := make([]string, 0, len(versions))
			for version := range versions {
				list = append(list, version)
			}
			sort.Strings(list)
			findings = append(findings, Finding{
				ID:          "version-drift-" + name,
				Category:    "dependency-consistency",
				Severity:    "warning",
				Title:       "Version drift for " + name,
				Details:     "Multiple versions found across projects: " + strings.Join(list, ", "),
				PackageName: name,
				Suggestion:  "Align all projects to a single version where possible.",
			})
		}

		if len(projects) >= 2 {
			_, rootHas := rootDeps[name]
			if !rootHas {
				findings = append(findings, Finding{
					ID:          "hoist-opportunity-" + name,
					Category:    "workspace-optimization",
					Severity:    "info",
					Title:       "Potential hoist candidate: " + name,
					Details:     "Dependency appears in multiple projects and is not declared at workspace root.",
					PackageName: name,
					Suggestion:  "Evaluate moving this dependency to the root package.json.",
				})
			}
		}
	}

	auditFindings := runNPMAudit(ctx, absRoot)
	findings = append(findings, auditFindings...)

	sort.Slice(findings, func(i, j int) bool {
		return severityWeight(findings[i].Severity) > severityWeight(findings[j].Severity)
	})

	return Report{
		WorkspacePath: absRoot,
		ScannedAt:     time.Now().UTC().Format(time.RFC3339),
		Findings:      findings,
	}, nil
}

func runNPMAudit(ctx context.Context, root string) []Finding {
	logFindings := make([]Finding, 0)
	lockfile := detectLockfile(root)
	if lockfile == "" {
		return []Finding{{
			ID:         "audit-skipped-no-lockfile",
			Category:   "security",
			Severity:   "info",
			Title:      "Dependency audit skipped",
			Details:    "No lockfile found at workspace root.",
			ProjectPath: "/",
			Suggestion: "Install dependencies first to generate lockfile, then run analysis again.",
		}}
	}

	auditCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	bin, args := auditCommand(lockfile)
	if _, err := exec.LookPath(bin); err != nil {
		return []Finding{{
			ID:          "audit-skipped-no-tool",
			Category:    "security",
			Severity:    "info",
			Title:       "Dependency audit skipped",
			Details:     fmt.Sprintf("%s is not available in PATH.", bin),
			ProjectPath: "/",
			Suggestion:  "Install the package manager for this workspace and retry analysis.",
		}}
	}

	out, err := runCommand(auditCtx, root, bin, args...)
	logFindings = append(logFindings, buildLogFinding("audit-initial", bin, args, err, out))
	if payload, ok := parseAuditPayload(out); ok {
		return buildAuditFindings(payload, logFindings)
	}
	if err != nil {
		installOut, installErr := ensureDependencies(ctx, root, lockfile)
		installBin, installArgs := installCommand(lockfile)
		logFindings = append(logFindings, buildLogFinding("install-deps", installBin, installArgs, installErr, installOut))
		if installErr == nil {
			retryCtx, retryCancel := context.WithTimeout(ctx, 20*time.Second)
			defer retryCancel()
			retryOut, retryErr := runCommand(retryCtx, root, bin, args...)
			logFindings = append(logFindings, buildLogFinding("audit-retry", bin, args, retryErr, retryOut))
			if payload, ok := parseAuditPayload(retryOut); ok {
				return buildAuditFindings(payload, logFindings)
			}
			if retryErr == nil {
				out = retryOut
				err = nil
			}
		}
	}

	if err != nil {
		findings := append([]Finding{}, logFindings...)
		findings = append(findings, Finding{
			ID:          "audit-unavailable",
			Category:    "security",
			Severity:    "info",
			Title:       "Dependency audit could not be completed",
			Details:     "Audit command failed (dependencies may not be installed).",
			ProjectPath: "/",
			Suggestion:  "Install dependencies in workspace root and retry analysis.",
		})
		return findings
	}

	if payload, ok := parseAuditPayload(out); ok {
		return buildAuditFindings(payload, logFindings)
	}
	return append(logFindings, Finding{
		ID:          "audit-parse-failed",
		Category:    "security",
		Severity:    "info",
		Title:       "Dependency audit output could not be parsed",
		Details:     "Audit command finished but output format was not recognized.",
		ProjectPath: "/",
		Suggestion:  "Check analyzer execution logs and try audit manually in workspace root.",
	})
}

func ensureDependencies(ctx context.Context, root string, lockfile string) (string, error) {
	bin, args := installCommand(lockfile)
	if _, err := exec.LookPath(bin); err != nil {
		return "", err
	}
	installCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	return runCommand(installCtx, root, bin, args...)
}

func detectLockfile(root string) string {
	if exists(filepath.Join(root, "pnpm-lock.yaml")) {
		return "pnpm-lock.yaml"
	}
	if exists(filepath.Join(root, "yarn.lock")) {
		return "yarn.lock"
	}
	if exists(filepath.Join(root, "package-lock.json")) {
		return "package-lock.json"
	}
	return ""
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func auditCommand(lockfile string) (string, []string) {
	switch lockfile {
	case "pnpm-lock.yaml":
		return "pnpm", []string{"audit", "--json"}
	case "yarn.lock":
		return "yarn", []string{"npm", "audit", "--json"}
	default:
		return "npm", []string{"audit", "--json"}
	}
}

func installCommand(lockfile string) (string, []string) {
	switch lockfile {
	case "pnpm-lock.yaml":
		return "pnpm", []string{"install", "--frozen-lockfile"}
	case "yarn.lock":
		return "yarn", []string{"install", "--immutable"}
	default:
		return "npm", []string{"ci"}
	}
}

func severityWeight(severity string) int {
	switch strings.ToLower(severity) {
	case "critical":
		return 5
	case "high":
		return 4
	case "moderate", "medium":
		return 3
	case "warning":
		return 2
	case "low":
		return 1
	default:
		return 0
	}
}

func runCommand(ctx context.Context, dir string, bin string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func buildLogFinding(id string, bin string, args []string, runErr error, output string) Finding {
	status := "ok"
	sev := "info"
	if runErr != nil {
		status = "error"
		sev = "warning"
	}
	details := fmt.Sprintf("command: %s %s | status: %s", bin, strings.Join(args, " "), status)
	if output != "" {
		details += " | output: " + trimForLog(output, 900)
	}
	if runErr != nil {
		details += " | error: " + runErr.Error()
	}
	return Finding{
		ID:          "exec-log-" + id,
		Category:    "analysis-runtime",
		Severity:    sev,
		Title:       "Analyzer log: " + id,
		Details:     details,
		ProjectPath: "/",
	}
}

func trimForLog(input string, max int) string {
	clean := strings.ReplaceAll(strings.ReplaceAll(input, "\r", " "), "\n", " ")
	clean = strings.TrimSpace(clean)
	if len(clean) <= max {
		return clean
	}
	return clean[:max] + "..."
}

func parseAuditPayload(output string) (map[string]any, bool) {
	output = strings.TrimSpace(output)
	if output == "" {
		return nil, false
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(output), &payload); err == nil {
		return payload, true
	}

	lines := strings.Split(output, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" || !strings.HasPrefix(line, "{") {
			continue
		}
		if err := json.Unmarshal([]byte(line), &payload); err == nil {
			return payload, true
		}
	}
	return nil, false
}

func buildAuditFindings(payload map[string]any, logFindings []Finding) []Finding {
	vulnsRaw, ok := payload["vulnerabilities"].(map[string]any)
	if !ok || len(vulnsRaw) == 0 {
		return append(logFindings, Finding{
			ID:          "audit-clean",
			Category:    "security",
			Severity:    "info",
			Title:       "No vulnerabilities reported by npm audit",
			ProjectPath: "/",
		})
	}

	findings := make([]Finding, 0, len(vulnsRaw)+len(logFindings))
	findings = append(findings, logFindings...)
	for pkg, raw := range vulnsRaw {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		severity, _ := item["severity"].(string)
		title := fmt.Sprintf("Vulnerability in %s", pkg)
		if severity == "" {
			severity = "warning"
		}
		findings = append(findings, Finding{
			ID:          "vuln-" + pkg,
			Category:    "security",
			Severity:    severity,
			Title:       title,
			Details:     "npm audit reported this package as vulnerable.",
			ProjectPath: "/",
			PackageName: pkg,
			Suggestion:  "Review npm audit details and update or replace the package.",
		})
	}
	return findings
}

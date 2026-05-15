package affected

import "time"

type ChangedFile struct {
	Path   string `json:"path"`
	Status string `json:"status"`
}

type AffectedProject struct {
	Name         string        `json:"name"`
	Root         string        `json:"root"`
	ChangedFiles []ChangedFile `json:"changedFiles"`
}

type Report struct {
	WorkspaceRoot    string            `json:"workspaceRoot"`
	ChangedFiles     []ChangedFile     `json:"changedFiles"`
	Projects         []AffectedProject `json:"projects"`
	GeneratedAt      time.Time         `json:"generatedAt"`
	NotGitRepository bool              `json:"notGitRepository"`
	Message          string            `json:"message"`
}

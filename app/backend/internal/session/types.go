package session

import "time"

type RuntimeSession struct {
	WorkspaceRoot string               `json:"workspaceRoot"`
	UpdatedAt     time.Time            `json:"updatedAt"`
	Items         []RuntimeSessionItem `json:"items"`
}

type RuntimeSessionItem struct {
	ProcessID string `json:"processID"`
	Command   string `json:"command"`
	WorkDir   string `json:"workDir"`
	Project   string `json:"project"`
	Target    string `json:"target"`
	ProfileID string `json:"profileID,omitempty"`
}

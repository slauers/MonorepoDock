package profiles

import "time"

type Profile struct {
	ID             string        `json:"id"`
	WorkspaceRoot  string        `json:"workspaceRoot"`
	Name           string        `json:"name"`
	Description    string        `json:"description"`
	Color          string        `json:"color"`
	Icon           string        `json:"icon"`
	AutoStart      bool          `json:"autoStart"`
	OpenLogsOnRun  bool          `json:"openLogsOnRun"`
	CreatedAt      time.Time     `json:"createdAt"`
	UpdatedAt      time.Time     `json:"updatedAt"`
	Items          []ProfileItem `json:"items"`
}

type ProfileItem struct {
	ID      string `json:"id"`
	Project string `json:"project"`
	Target  string `json:"target"`
	WorkDir string `json:"workDir"`
	Command string `json:"command"`
}

type ProfileRuntimeState struct {
	ProfileID    string   `json:"profileID"`
	Status       string   `json:"status"`
	RunningCount int      `json:"runningCount"`
	StoppedCount int      `json:"stoppedCount"`
	FailedCount  int      `json:"failedCount"`
	ProcessIDs   []string `json:"processIDs"`
}

type ItemRunError struct {
	ItemID  string `json:"itemId"`
	Command string `json:"command"`
	Message string `json:"message"`
}

type ProfileRunError struct {
	ProfileID string         `json:"profileId"`
	Failures  []ItemRunError `json:"failures"`
}

func (e *ProfileRunError) Error() string {
	if e == nil || len(e.Failures) == 0 {
		return ""
	}
	return "one or more profile items failed to start"
}

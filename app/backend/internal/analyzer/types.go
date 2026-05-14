package analyzer

type Report struct {
	WorkspacePath string    `json:"workspacePath"`
	ScannedAt     string    `json:"scannedAt"`
	Findings      []Finding `json:"findings"`
}

type Finding struct {
	ID         string `json:"id"`
	Category   string `json:"category"`
	Severity   string `json:"severity"`
	Title      string `json:"title"`
	Details    string `json:"details"`
	ProjectPath string `json:"projectPath"`
	PackageName string `json:"packageName"`
	Suggestion string `json:"suggestion"`
	Reference  string `json:"reference"`
	FixVersion string `json:"fixVersion"`
}

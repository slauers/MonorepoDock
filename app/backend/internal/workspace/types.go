package workspace

type Project struct {
	Name    string   `json:"name"`
	Path    string   `json:"path"`
	Scripts []string `json:"scripts"`
	Targets []Target `json:"targets"`
}

type Target struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Command string `json:"command"`
	WorkDir string `json:"workDir"`
	Kind    string `json:"kind"`
}

type Summary struct {
	RootPath      string    `json:"rootPath"`
	PackageManager string   `json:"packageManager"`
	MonorepoTool  string    `json:"monorepoTool"`
	GitBranch     string    `json:"gitBranch"`
	Projects      []Project `json:"projects"`
}

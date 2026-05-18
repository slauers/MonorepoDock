package ports

type Candidate struct {
	Port   int    `json:"port"`
	Source string `json:"source"`
}

type Conflict struct {
	Port             int    `json:"port"`
	PID              int    `json:"pid"`
	Command          string `json:"command"`
	Managed          bool   `json:"managed"`
	ManagedProcessID string `json:"managedProcessID"`
}

type Report struct {
	WorkDir       string      `json:"workDir"`
	Command       string      `json:"command"`
	Ports         []Candidate `json:"ports"`
	Conflicts     []Conflict  `json:"conflicts"`
	SuggestedPort int         `json:"suggestedPort"`
	Message       string      `json:"message"`
}

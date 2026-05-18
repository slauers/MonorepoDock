package deps

import "time"

type DependencyNode struct {
	Project     string   `json:"project"`
	Path        string   `json:"path"`
	PackageName string   `json:"packageName"`
	DependsOn   []string `json:"dependsOn"`
	UsedBy      []string `json:"usedBy"`
	Impact      DependencyImpact `json:"impact"`
}

type DependencyImpact struct {
	Project               string   `json:"project"`
	DirectDependencies    []string `json:"directDependencies"`
	DirectDependents      []string `json:"directDependents"`
	TransitiveDependents  []string `json:"transitiveDependents"`
}

type DependencyEdge struct {
	From       string `json:"from"`
	To         string `json:"to"`
	Dependency string `json:"dependency"`
}

type Report struct {
	WorkspaceRoot string           `json:"workspaceRoot"`
	Nodes         []DependencyNode `json:"nodes"`
	Edges         []DependencyEdge `json:"edges"`
	GeneratedAt   time.Time        `json:"generatedAt"`
	Message       string           `json:"message"`
}

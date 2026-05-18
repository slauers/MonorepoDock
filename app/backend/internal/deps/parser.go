package deps

import (
	"encoding/json"
	"os"
)

type packageManifest struct {
	Name            string            `json:"name"`
	Dependencies    map[string]string `json:"dependencies"`
	DevDependencies map[string]string `json:"devDependencies"`
}

func readPackageManifest(path string) (packageManifest, bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return packageManifest{}, false, nil
		}
		return packageManifest{}, false, err
	}

	var doc packageManifest
	if err := json.Unmarshal(raw, &doc); err != nil {
		return packageManifest{}, false, nil
	}
	return doc, true, nil
}

func (m packageManifest) dependencyNames() []string {
	seen := map[string]bool{}
	names := make([]string, 0, len(m.Dependencies)+len(m.DevDependencies))
	for name := range m.Dependencies {
		if seen[name] {
			continue
		}
		seen[name] = true
		names = append(names, name)
	}
	for name := range m.DevDependencies {
		if seen[name] {
			continue
		}
		seen[name] = true
		names = append(names, name)
	}
	return names
}

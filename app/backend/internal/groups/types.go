package groups

import "time"

type Group struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Roots     []string  `json:"roots"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

# MonoDock Architecture (MVP)

## App Layout

- `app/backend`: Go backend with Wails bindings and core services.
- `app/frontend`: React + TypeScript operational UI.
- `labs/*`: validation workspaces for detector/runner behavior.

## Backend Responsibilities

- `internal/detector`: package manager and monorepo tool detection.
- `internal/workspace`: workspace inspection and project/script discovery.
- `internal/git`: git branch resolution.
- `internal/runner`: process lifecycle and real-time log streaming.
- `internal/config`: recent workspace persistence.

## Frontend Responsibilities

- `services/wails.ts`: isolates direct Wails API calls.
- `stores/useWorkspaceStore.ts`: app state and orchestration.
- `App.tsx`: operator-first workspace, process and log surfaces.


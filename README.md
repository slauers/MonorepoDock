# MonoDock

MonoDock is a visual desktop runtime for monorepos.  
It is designed to feel like Docker Desktop for workspace operations: detect projects, run targets, manage processes, and inspect logs in one place.

## Stack

- Wails + Go (backend/app shell)
- React + TypeScript + Vite (frontend)
- Zustand (state)

## Current Features

- Open and inspect local workspaces
- Detect monorepo tools and package managers
- List projects and runnable targets
- Start/stop/restart processes
- Live logs with tabs, close tab, and copy actions
- Analyze dependencies (security + consistency + hoist opportunities)
- Recent workspaces, theme toggle, and hacker mode

## Local Development

Requirements:

- Go
- Node.js + npm
- Wails CLI

Run:

```bash
cd app/backend
wails dev
```

## Labs

Sample monorepos for testing are available under `labs/`:

- `pnpm-basic`
- `nx-basic`
- `turbo-basic`
- `go-workspace`
- `docker-stack`

## GitHub Pages

Project page and screenshots:

- https://slauers.github.io/monodock/
- https://slauers.github.io/monodock/screenshots.html

## Release Pipeline

GitHub Actions release workflow is available at:

- `.github/workflows/release.yml`

How to publish a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

This triggers a multi-platform build (Windows, macOS, Linux) and publishes assets to the GitHub Release for that tag.

---

by slauers

# ADR-001: Monorepo tooling — npm workspaces

## Status

Accepted

## Context

The personal-kanban project will be split into multiple packages: `kanban-core`, `kanban-cli`, `kanban-web`, and the existing `vscode-extension`. These packages share types and logic. A monorepo strategy is needed so packages can reference each other locally during development and be published independently.

Options considered:
- **npm workspaces** — built into npm ≥7, zero extra tooling, sufficient for this project scale
- **pnpm workspaces** — stricter hoisting, faster installs, requires pnpm adoption
- **Turborepo** — build orchestration layer on top of workspaces, useful at larger scale

## Decision

Use **npm workspaces**. The project has no CI caching requirements, no cross-package build pipelines that need orchestration, and no team adoption cost to manage. npm workspaces is the minimal correct tool for the current scale.

## Consequences

- Root `package.json` gains `"workspaces": ["packages/*"]`
- Each package under `packages/` has its own `package.json` with its own name, version, and dependencies
- `node_modules` is hoisted to root; packages reference each other via `"@personal-kanban/core": "*"` in their local `package.json`
- Migrating to pnpm or Turborepo later is straightforward — workspaces API is compatible

# ADR-002: kanban-core extraction scope

## Status

Accepted

## Context

The current VSCode extension bundles all board logic in `src/io.ts`, `src/hooks.ts`, and `src/types.ts`. To support a CLI and web app, this logic must live in a shared package (`kanban-core`) that all consumers import. The key question is what belongs in core vs what stays in each consumer.

## Decision

`packages/kanban-core` contains:
- Everything from `src/types.ts` (all shared TypeScript types)
- Everything from `src/io.ts` (file I/O, board state loading, locking, fractional ordering)
- Hook/policy runner from `src/hooks.ts`, with VSCode logger dependency removed — replaced with a pluggable `Logger` interface that consumers inject
- No VSCode API imports anywhere in core

What stays in the consumer layer:
- VSCode output channel logging (extension injects its own logger)
- CLI stderr/stdout logging (CLI injects its own logger)
- Webview message protocol (extension only)
- Express route handlers (web only)

## Consequences

- `hooks.ts` must be refactored: `initLogger()` and `logInfo()` replaced with an injected `Logger` interface
- VSCode extension becomes a thin shell: imports from `@personal-kanban/core`, passes its output channel as the logger
- Core has zero runtime dependencies on `vscode` — it is a plain Node.js package
- Core can be unit-tested without a VSCode test harness

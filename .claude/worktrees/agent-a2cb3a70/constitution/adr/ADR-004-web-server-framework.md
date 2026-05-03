# ADR-004: Web server framework selection

## Status

Accepted

## Context

`packages/kanban-web` needs an HTTP server to expose the kanban board as a local web app. The server runs locally on the user's machine. It must handle REST API calls and serve static assets.

Options considered:
- **Express** — dominant ecosystem, large middleware library, `@types/express` required
- **Fastify** — faster, TypeScript-first, schema-driven validation
- **Hono** — ultra-lightweight, edge-compatible, excellent TS types

## Decision

Use **Express**. It is the simplest to reason about for a local tool, has the largest ecosystem for middleware if needed, and the performance delta vs Fastify/Hono is irrelevant for a single-user local server. The team is familiar with its API. TypeScript support via `@types/express` is mature.

## Consequences

- `packages/kanban-web/package.json` depends on `express` and `@types/express`
- Static assets served via `express.static()`
- All route handlers are thin wrappers over `@personal-kanban/core` functions
- No business logic in route handlers

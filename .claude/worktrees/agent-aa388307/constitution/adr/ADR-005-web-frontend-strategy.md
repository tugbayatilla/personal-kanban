# ADR-005: Web frontend strategy

## Status

Accepted

## Context

The VSCode extension has a working board UI in `media/board.js` and `media/board.css` that uses `vscode.postMessage()` for communication. The web app needs the same visual board communicating via `fetch()` instead.

Options considered:
- **Reuse existing assets with a thin adapter** — replace postMessage shim with fetch calls
- **Rewrite frontend with a framework** (React, Vue, Svelte) — throws away working code
- **Shared UI source compiled to two targets** — complex build setup

## Decision

**Reuse existing assets with a thin adapter**. An audit of `media/board.js` shows that VSCode-specific calls are isolated to the message-passing boundary. An `adapter.js` file (≤50 lines) can shim `vscode.postMessage` with `fetch()` calls and translate server responses into the existing message format the board already handles.

## Consequences

- `packages/kanban-web/src/public/adapter.js` translates fetch ↔ postMessage protocol
- `media/board.js` is copied (not forked) into the web package — changes must be kept in sync
- The VSCode extension webview protocol does NOT change
- Long-term: if the two copies diverge significantly, consider a shared build step

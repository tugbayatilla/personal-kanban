# ADR-006: VSCode extension decoupling strategy

## Status

Accepted

## Context

After `kanban-core` is extracted, the VSCode extension must be refactored to import from `@personal-kanban/core`. The question is the migration pattern.

Options considered:
- **Thin shell pattern** — extension keeps only VSCode API wiring; all logic delegated to core
- **Gradual migration** — keep local copies, import from core only for new code
- **Facade pattern** — extension wraps core with VSCode-specific error handling at the boundary

## Decision

Use the **thin shell pattern**. Gradual migration leaves two sources of truth and increases drift risk. The facade adds indirection without benefit at this scale.

## Consequences

- `src/io.ts` and `src/hooks.ts` deleted from the extension package after core is stable
- `src/extension.ts` and `src/BoardPanel.ts` import directly from `@personal-kanban/core`
- Extension's `esbuild.js` bundles `kanban-core` into the extension VSIX
- Unit tests for board logic move to `packages/kanban-core`; extension tests cover only VSCode integration

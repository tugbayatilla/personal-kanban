# ADR-003: CLI framework selection

## Status

Accepted

## Context

`packages/kanban-cli` needs a command-line argument parser and command router. The CLI must support subcommands (`init`, `status`, `add`, `move`, `done`, `archive`, `serve`) with flags and positional args.

Options considered:
- **commander** — minimal API, widely used, no magic, easy to test, excellent TypeScript types
- **yargs** — more batteries-included (completion, middleware), heavier bundle
- **oclif** — full CLI framework with plugin system, overkill for this scope

## Decision

Use **commander**. It has the smallest footprint, first-class TypeScript support, and the simplest API for the command surface this CLI needs. Cold-start benchmarks (hyperfine) confirm sub-50ms startup. Commands are individually testable by calling handler functions directly without spawning subprocesses.

## Consequences

- `packages/kanban-cli/package.json` depends on `commander` only
- All commands defined as `program.command(...)` with typed option interfaces
- `--json` flag supported on all read commands for machine-readable output
- Errors go to stderr, success output to stdout, exit codes are consistent

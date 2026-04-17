# Mission

Personal Kanban is a file-based kanban board that lives inside your project. The entire board state — every card, every column assignment, every piece of metadata — is stored in plain Markdown files alongside your code.

## The Problem

Kanban tools are either too heavy or too disconnected. SaaS boards require accounts, internet access, and a separate context switch. Lightweight alternatives have no git integration. Neither kind can be read or modified by an AI agent without special tooling.

Teams end up with a board that drifts from the actual code: tasks live in one place, commits live in another, and neither knows about the other.

## What We Build

A kanban board that is:

- **A folder, not a service.** Board state is `.personal-kanban/` — a directory of Markdown files checked in alongside the code. No server. No account. No sync daemon.
- **One card, one file.** Each card is a standalone `.md` file with YAML frontmatter. One card changed in git = one file in the diff. The history of a card is the git history of its file.
- **Plain text throughout.** Every field is human-readable and human-editable. Moving a card is changing the `column:` field in a frontmatter. Reordering is changing a decimal. Nothing is opaque.
- **AI-native.** The file format is structured so an AI agent can read board state, create cards, and move work through columns using the same text-editing tools it uses for code.
- **Extensible without a plugin model.** Hooks run Node.js scripts on board events. Scripts receive a JSON payload via stdin and can read or modify card files using plain helpers. No framework. No registration.

## Core Principles

**Local first.** The board works without internet, without a server, and without the extension installed. The files are the source of truth — the extension is just a viewer and editor.

**Git is the history.** We do not build audit logs, change history, or undo systems. Git does that. Cards are files; `git log cards/20260326-b7c2.md` is the card's history.

**Zero dependencies.** The extension has no production npm dependencies. All functionality is built on VSCode's extension API and Node.js stdlib. Fewer dependencies means fewer breakages, smaller install size, and a codebase that remains readable.

**The data format is the API.** The manifest schema, card frontmatter fields, hook payload shape, and script conventions are stable public contracts. External tools, AI agents, and scripts can depend on them.

**Complexity only where warranted.** Midpoint ordering over fractional indexing, atomic file locking, and sequential hook dispatch exist because they solve real problems. Features exist to serve users, not to demonstrate cleverness.

## Who It's For

Individual developers and small teams who:

- Want their board in the same git repository as their code
- Collaborate with AI coding assistants (Claude Code, Copilot, etc.)
- Need to automate board events with custom scripts
- Prefer a minimal tool they can fully understand over a feature-rich one they cannot

# Roadmap

This document describes where the project is going. Items are grouped by theme, not by release. There is no fixed timeline — priorities shift with what is most valuable to users.

---

## In Progress

Nothing currently in flight beyond maintenance.

---

## Near Term

### Claude Code skill (`/personal-kanban`)

A `.claude/skills/personal-kanban.md` skill file that lets Claude Code manage the board directly from the terminal. Planned commands:

| Command | Description |
|---|---|
| `/personal-kanban` | Show board status: columns, card counts, titles |
| `/personal-kanban list` | All cards grouped by column with tags and branches |
| `/personal-kanban start` | Move top Refined (or Backlog) card to In Progress, create git branch, save branch to card metadata |
| `/personal-kanban review` | Push branch, move active In Progress card to Review |
| `/personal-kanban done [title]` | Merge card's branch into main, delete branch, move card to Done |
| `/personal-kanban new #tag Title` | Create a new card directly in In Progress |
| `/personal-kanban raise #tag Title` | Create a card from a review finding |

The skill reads card files and the manifest directly — no extension host required, no special protocol. This makes it usable in headless environments and during CI-driven workflows.

### `card.git-merged` hook

Fire a `card.git-merged` event when a card's branch is merged. The default script would automatically move the card to Done and clear the `branch` field. The hook payload would include `card_id`, `branch`, and `merged_into`.

This completes the git ↔ board feedback loop: a merge in the terminal updates the board without manual intervention.

---

## Medium Term

### Column rules engine

The `rules` field on each column is currently reserved. The intent is to define declarative per-column policies that the extension evaluates automatically on card events.

Proposed rule types:
- `require_fields` — block a move into a column unless specified frontmatter fields are present
- `auto_stamp` — write a metadata field automatically when a card enters the column
- `auto_move` — move a card to another column when a condition is met (e.g. all checklist items checked)

Rules would be expressed as plain JSON in the manifest. No scripting required for common automation.

Example:
```json
{
  "id": "in-progress",
  "rules": {
    "require_fields": ["branch"],
    "auto_stamp": { "started_at": "now" }
  }
}
```

### Board-level analytics view

A secondary panel (or a section of the board) showing flow metrics derived from card frontmatter:

- **Throughput** — cards completed per week over the last N weeks
- **Lead time distribution** — histogram of `done_at - created_at` for Done/archived cards
- **Cycle time distribution** — histogram of `done_at - active_at`
- **WIP over time** — cards in In Progress column day by day

All data is computed from local files — no telemetry, no external service.

### Multi-board support

Currently one board per workspace root. Some projects benefit from separate boards for different concerns (e.g. features vs. bugs vs. infrastructure).

Proposed: allow multiple named board directories, switchable via a command. Each board has its own manifest and cards directory. The active board is stored in workspace state.

---

## Longer Term

### Card dependencies

Express that card B is blocked by card A. Visualized as a badge on the blocked card and an optional dependency graph view. Stored as a `blocked_by: [id]` frontmatter field. No separate data structure.

### Checklist items as sub-tasks

Markdown checkboxes within a card body (`- [ ] item`) rendered interactively in the board. Checking an item updates the file. Optionally, a column rule could auto-move a card to the next column when all checkboxes are checked.

### VSCode sidebar panel

An alternative to the full webview panel: a lightweight sidebar tree view showing card counts per column and a quick-add input. Useful on smaller screens or when switching between the board and code frequently.

### Repeating cards

Cards that re-appear in Backlog on a schedule (daily standups, weekly reviews). The recurrence rule would be stored in frontmatter (`recur: weekly`). A background process or hook would create the next instance when the current one is archived.

---

## Non-Goals

These are things we have explicitly decided not to build:

- **Sync to external services** (Linear, Jira, GitHub Issues). The board is local-first. Integration is possible via hooks and scripts, but the extension will not ship built-in connectors.
- **Real-time collaboration**. The file format is git-mergeable; teams collaborate through git. Simultaneous live editing of the same board by multiple people is out of scope.
- **Card history / undo**. Git is the history. The extension does not maintain its own change log.
- **Rich text editor**. Cards are Markdown. The inline editor is a plain textarea. Formatting is applied at render time.
- **Mobile support**. VSCode does not run on mobile. This is a desktop developer tool.

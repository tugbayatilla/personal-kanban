# Plan: Card Folder Structure & Split Config

## Overview

Four responsibilities, four places:

| Concern | Where |
|---|---|
| Board config (columns, tags, hooks, WIP limits, board path) | VSCode workspace `settings.json` |
| Board structure (card order per column) | `manifest.json` |
| Card data (content + activity log) | Folder per card |
| Board-level audit trail | VSCode Output Channel + `board.log` |

---

## New Card Structure

Each card becomes a folder named by its ID, containing the card file and its log:

```
.personal-kanban/
  manifest.json
  board.log                ← central audit log (append-only, all events)
  cards/
    20260328-5bf4/
      20260328-5bf4.md     ← same format as today (frontmatter + body)
      20260328-5bf4.log    ← card-level activity log (moved from logs/cards/)
    20260328-d9a6/
      20260328-d9a6.md
      20260328-d9a6.log
```

The `.md` file format is unchanged — YAML frontmatter + markdown body.

```markdown
---
id: 20260328-5bf4
created_at: 2026-03-28T09:00:00.000Z
updated_at: 2026-03-28T14:30:00.000Z
branch: feature/card-folder-structure
---

#feature #claude-code

# Add folder structure for cards

Each card stored as a folder containing the card file and its activity log.
```

The `.log` file is append-only, one entry per line:

```
2026-03-28T09:00:00Z  created in backlog
2026-03-28T10:00:00Z  moved backlog → refined
2026-03-28T14:30:00Z  moved refined → in-progress
2026-03-28T14:31:00Z  branch set: feature/card-folder-structure
```

---

## manifest.json — Board Structure Only

`manifest.json` is kept but stripped down to board structure only: which cards are in which column and in what order.

```json
{
  "version": 3,
  "columns": {
    "backlog":     ["20260328-a1bd"],
    "refined":     ["20260328-5bf4", "20260328-d9a6", "20260328-7235"],
    "in-progress": [],
    "review":      [],
    "done":        ["20260328-c7f2", "20260328-b75c"]
  }
}
```

No column definitions, no tags, no hooks, no WIP limits — those all move to VSCode settings.

---

## VSCode Settings — Board Config

All configuration lives in workspace `settings.json`:

```json
{
  "personalKanban.boardPath": ".personal-kanban",

  "personalKanban.columns": [
    { "id": "backlog",     "label": "Backlog",     "wipLimit": null },
    { "id": "refined",     "label": "Refined",     "wipLimit": null },
    { "id": "in-progress", "label": "In Progress", "wipLimit": 3    },
    { "id": "review",      "label": "Review",      "wipLimit": 1    },
    { "id": "done",        "label": "Done",        "wipLimit": null }
  ],

  "personalKanban.tags": {
    "bug":         { "color": "#e74c3c" },
    "feature":     { "color": "#2ecc71" },
    "improvement": { "color": "#3498db" },
    "claude-code": { "color": "#9b59b6" }
  },

  "personalKanban.hooks": {
    "card.created":      { "file": ".personal-kanban/scripts/card-created.js"   },
    "card.updated":      { "file": ".personal-kanban/scripts/card-updated.js"   },
    "card.deleted":      { "file": ".personal-kanban/scripts/card-deleted.js"   },
    "card.archived":     { "file": ".personal-kanban/scripts/card-archived.js"  },
    "card.in-progress":  { "file": ".personal-kanban/scripts/card-started.js"   },
    "card.review":       { "file": ".personal-kanban/scripts/card-reviewed.js"  },
    "card.done":         { "file": ".personal-kanban/scripts/card-to-done.js"   },
    "wip.violated":      { "file": ".personal-kanban/scripts/wip-alert.js"      }
  }
}
```

### Settings Reference

#### `personalKanban.boardPath`
Path to the board content folder, relative to workspace root. Default: `".personal-kanban"`.

#### `personalKanban.columns`
Ordered list of columns. Order here defines the visual order on the board.

| Field      | Type           | Description                              |
|------------|----------------|------------------------------------------|
| `id`       | string         | Unique column slug                       |
| `label`    | string         | Display name                             |
| `wipLimit` | number or null | Max cards in column; `null` = no limit   |

#### `personalKanban.tags`
Keys are tag names (without `#`). Values define display config.

| Field   | Type   | Description              |
|---------|--------|--------------------------|
| `color` | string | Hex color for tag badge  |

#### `personalKanban.hooks`
Keys are event names. Script paths are resolved relative to workspace root.

| Event                  | Fires when                                          |
|------------------------|-----------------------------------------------------|
| `card.created`         | A new card is created                               |
| `card.updated`         | A card's content or metadata is saved               |
| `card.deleted`         | A card is permanently deleted                       |
| `card.archived`        | A card is archived                                  |
| `card.<column-slug>`   | A card is moved into that column (any column slug)  |
| `wip.violated`         | A column's WIP limit is exceeded                    |

`card.<column-slug>` is dynamic — define a hook for any column by its ID, e.g. `card.in-progress`, `card.review`, `card.done`. Multiple hooks can be registered for the same event.

Scripts receive the card ID as the first argument and can be `.js` (Node) or `.sh` (shell).

---

## Board Log

Every event — regardless of whether the card still exists — is written to two places:

1. **`board.log`** — persistent file at `.personal-kanban/board.log`, append-only.
2. **VSCode Output Channel** — "Personal Kanban" channel in the Output panel, visible in real time without opening any file.

The Output Channel is ephemeral (cleared on VSCode restart); `board.log` is the durable record.

```
2026-03-28T09:00:00Z  [card.created]   20260328-5bf4  "Add folder structure for cards"  backlog
2026-03-28T10:00:00Z  [card.updated]   20260328-5bf4
2026-03-28T14:30:00Z  [card.in-progress] 20260328-5bf4  refined → in-progress
2026-03-28T15:00:00Z  [wip.violated]   in-progress  limit=3  count=4
2026-03-28T16:00:00Z  [card.deleted]   20260328-a1bd  "Some old card"
```

Card-level events are also written to the card's own `<id>.log`. `board.log` is the authoritative source for events like `card.deleted` where the card folder no longer exists.

---

## Board Load Behavior

1. Read `personalKanban.columns` from VSCode settings → column order and config.
2. Read `manifest.json` → card IDs per column, in order.
3. For each card ID, read `cards/<id>/<id>.md` → card content and metadata.

---

## Migration from Current Format

| Before | After |
|---|---|
| `manifest.json` (columns + cards + hooks + tags) | `manifest.json` (cards per column only) + `settings.json` (config) |
| `cards/<column>/<id>.md` | `cards/<id>/<id>.md` |
| `logs/cards/<id>.log` | `cards/<id>/<id>.log` |
| _(no central log)_ | `board.log` + VSCode Output Channel |

Migration steps:
1. Move each card file: `cards/<column>/<id>.md` → `cards/<id>/<id>.md`.
2. Move each log file: `logs/cards/<id>.log` → `cards/<id>/<id>.log`.
3. Strip `manifest.json` down to `columns` (card ID lists only).
4. Copy column definitions, tags, hooks from `manifest.json` → workspace `settings.json`.
5. Create `board.log` (empty).
6. Delete `logs/` directory.

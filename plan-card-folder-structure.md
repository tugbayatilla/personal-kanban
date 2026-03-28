Proposed plan: ignore now.

# Plan: Card Folder Structure & VSCode Config

## Overview

Replace the file-based card format and `manifest.json` with:
- **Folder-per-card** structure under `.personal-kanban/cards/`
- **VSCode workspace settings** as the single source of config (columns, tags, hooks, WIP limits, board path)

---

## New Card Structure

Each card becomes a folder named by its ID:

```
.personal-kanban/
  cards/
    20260328-5bf4/
      content.md       ← markdown body (no frontmatter)
      metadata.json    ← all card data + move history
      activity.log     ← append-only activity log
    20260328-d9a6/
      content.md
      metadata.json
      activity.log
```

### `content.md`

Plain markdown. No frontmatter. Just the card body.

```markdown
#feature #claude-code

# Add folder structure for cards

Each card should be stored as a folder containing separate files
for content, metadata, and activity.
```

### `metadata.json`

Holds all structured data about the card, including its current column and full move history.

```json
{
  "id": "20260328-5bf4",
  "title": "Add folder structure for cards",
  "column": "in-progress",
  "position": 1,
  "tags": ["feature", "claude-code"],
  "branch": "feature/card-folder-structure",
  "createdAt": "2026-03-28T09:00:00.000Z",
  "updatedAt": "2026-03-28T14:30:00.000Z",
  "timeline": [
    { "column": "backlog",     "movedAt": "2026-03-28T09:00:00.000Z" },
    { "column": "refined",     "movedAt": "2026-03-28T10:00:00.000Z" },
    { "column": "in-progress", "movedAt": "2026-03-28T14:30:00.000Z" }
  ]
}
```

**Fields:**

| Field       | Type            | Description                                |
| ----------- | --------------- | ------------------------------------------ |
| `id`        | string          | Card ID — `YYYYMMDD-xxxx` format           |
| `title`     | string          | Card title (first heading from content.md) |
| `column`    | string          | Current column ID                          |
| `position`  | number          | 0-based index within the column            |
| `tags`      | string[]        | Tag names (without `#`)                    |
| `branch`    | string?         | Git branch associated with this card       |
| `createdAt` | ISO 8601 string | Creation timestamp                         |
| `updatedAt` | ISO 8601 string | Last modification timestamp                |
| `timeline`  | array           | Ordered list of column moves, oldest first |

### `activity.log`

Append-only log of all events on this card. One entry per line in plain text.

```
2026-03-28T09:00:00Z  created in backlog
2026-03-28T10:00:00Z  moved backlog → refined
2026-03-28T14:30:00Z  moved refined → in-progress
2026-03-28T14:31:00Z  branch set: feature/card-folder-structure
2026-03-28T15:00:00Z  content updated
```

---

## VSCode Config

All board configuration moves into VSCode workspace settings (`settings.json`). No `manifest.json`.

### Schema

```json
{
  "personalKanban.boardPath": ".personal-kanban",

  "personalKanban.columns": [
    { "id": "backlog",     "label": "Backlog",      "wipLimit": null },
    { "id": "refined",     "label": "Refined",      "wipLimit": null },
    { "id": "in-progress", "label": "In Progress",  "wipLimit": 3    },
    { "id": "review",      "label": "Review",       "wipLimit": 1    },
    { "id": "done",        "label": "Done",         "wipLimit": null }
  ],

  "personalKanban.tags": {
    "bug":        { "color": "#e74c3c" },
    "feature":    { "color": "#2ecc71" },
    "improvement":{ "color": "#3498db" },
    "claude-code":{ "color": "#9b59b6" }
  },

  "personalKanban.hooks": {
    "card.done":     { "file": ".personal-kanban/scripts/card-to-done.js"  },
    "wip.violated":  { "file": ".personal-kanban/scripts/wip-alert.js"     },
    "card.reviewed": { "file": ".personal-kanban/scripts/card-reviewed.js" }
  }
}
```

### Settings Reference

#### `personalKanban.boardPath`
- Type: `string`
- Default: `".personal-kanban"`
- Path to the board content folder, relative to the workspace root.

#### `personalKanban.columns`
- Type: `array`
- Defines the ordered list of columns on the board.

| Field      | Type           | Description                              |
| ---------- | -------------- | ---------------------------------------- |
| `id`       | string         | Unique column identifier (slug)          |
| `label`    | string         | Display name shown on the board          |
| `wipLimit` | number or null | Max cards allowed; `null` means no limit |

#### `personalKanban.tags`
- Type: `object`
- Keys are tag names (without `#`). Values are display config.

| Field   | Type   | Description                 |
| ------- | ------ | --------------------------- |
| `color` | string | Hex color for the tag badge |

#### `personalKanban.hooks`
- Type: `object`
- Keys are event names. Values point to a script file.

| Event           | Fires when                             |
| --------------- | -------------------------------------- |
| `card.done`     | A card is moved to the `done` column   |
| `wip.violated`  | A column's WIP limit is exceeded       |
| `card.reviewed` | A card is moved to the `review` column |

Scripts can be `.js` (Node) or `.sh` (shell). The extension resolves paths relative to the workspace root.

---

## Board Load Behavior

Without `manifest.json`, the extension builds board state by:

1. Reading `personalKanban.columns` from VSCode settings to get the ordered column list.
2. Scanning `<boardPath>/cards/*/metadata.json` to load all cards.
3. Grouping cards by `metadata.column`, sorted by `metadata.position` within each column.

This makes each card fully self-describing — the board state is derived, not stored centrally.

---

## Migration from Current Format

| Before                                        | After                                       |
| --------------------------------------------- | ------------------------------------------- |
| `manifest.json` (columns, hooks, tags)        | `settings.json` (VSCode workspace settings) |
| `cards/<column>/<id>.md` (frontmatter + body) | `cards/<id>/content.md` + `metadata.json`   |
| `logs/cards/<id>.log`                         | `cards/<id>/activity.log`                   |

Migration steps:
1. For each card file: extract frontmatter → `metadata.json`, body → `content.md`, existing log → `activity.log`.
2. Add `timeline` to `metadata.json` from the card's column history (derive from current column if no history).
3. Copy `manifest.json` columns, tags, hooks → workspace `settings.json`.
4. Delete `manifest.json` and `logs/` directory.

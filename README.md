# Personal Kanban

A file-based personal kanban board for VSCode. The entire board state lives in plain text files inside your project — no database, no server, no account required.

## Features

- **Git-friendly** — one card changed = one file changed; commit your board alongside your code
- **File-based** — board state is human-readable Markdown you can edit directly
- **AI-readable** — structured so an AI can understand board state without special tooling
- **Drag and drop** — move cards between columns and reorder within a column
- **Inline editing** — double-click any card to edit (markdown supported)
- **Tag system** — write `#tagname` anywhere in a card; tags appear automatically
- **Live sync** — editing card files or `manifest.json` externally refreshes the board instantly
- **Lead time & cycle time** — done cards show lead time (creation → done); the metadata popup shows both
- **Hooks** — run Node.js scripts on board events (card moved, WIP exceeded, etc.)

## Commands

| Command | Description |
|---|---|
| `Personal Kanban: Init Board` | Creates `.personal-kanban/` with a default board, columns, and starter scripts |
| `Personal Kanban: Open Board` | Opens the Kanban board webview panel |

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type `Personal Kanban` to find both commands.

## Board Structure

Running `Personal Kanban: Init Board` creates:

```
{workspace-root}/
└── .personal-kanban/
    ├── manifest.json      ← column definitions, scripts, and hooks
    ├── GUIDELINES.md      ← editable workflow guidelines
    ├── cards/
    │   └── {id}.md        ← one file per active card
    ├── archive/
    │   └── {id}.md        ← archived cards (moved from Done)
    └── scripts/
        ├── lib.js          ← shared helpers (notify, readCard, updateCardMetadata)
        ├── card-created.js
        ├── card-edited.js
        ├── card-deleted.js
        ├── card-moved.js
        ├── card-reviewed.js
        ├── cards-archived.js
        └── wip-alert.js
```

The default columns are **Backlog**, **Refined**, **In Progress**, **Review**, and **Done**. To change column names, reorder, or adjust WIP limits, edit `manifest.json` directly.

### manifest.json

```json
{
  "version": 1,
  "name": "my-project",
  "columns": [
    { "id": "backlog",     "label": "Backlog",     "index": 0, "wip_limit": null, "rules": {} },
    { "id": "refined",     "label": "Refined",     "index": 1, "wip_limit": null, "rules": {} },
    { "id": "in-progress", "label": "In Progress", "index": 2, "wip_limit": 1,    "rules": {} },
    { "id": "review",      "label": "Review",      "index": 3, "wip_limit": null, "rules": {} },
    { "id": "done",        "label": "Done",        "index": 4, "wip_limit": null, "rules": {} }
  ],
  "scripts": {
    "card-moved": { "file": "scripts/card-moved.js" }
  },
  "hooks": {
    "card.moved": ["card-moved"]
  }
}
```

- `index` controls the left-to-right column order on the board.
- `wip_limit` triggers a `wip.violated` hook event when a column exceeds its limit (`null` = no limit).
- `rules` is reserved for future automation rules.
- `scripts` and `hooks` define which Node.js scripts run on board events.

### Card files

Each card is a Markdown file in `cards/{id}.md` with YAML frontmatter:

```
---
id: 20260326-b7c2
created_at: 2026-03-26T10:00:00.000Z
column: in-progress
order: 0.5
active_at: 2026-03-27T09:00:00.000Z
branch: feature/my-feature
---

#feature

# Card title

Description text.
```

- `column` — which column this card belongs to. Default: `backlog` if absent.
- `order` — position within the column (decimal between 0 and 1; lower = higher/top).
- `active_at` — stamped automatically when first moved to `in-progress`.
- `done_at` — stamped automatically when moved to `done`.
- `branch` — set when work begins on a card.
- Any additional fields you add to the frontmatter are preserved and shown in the metadata popup.

Card IDs are `YYYYMMDD-xxxx` (UTC date + 4 random hex chars), e.g. `20260326-b7c2`.

## Usage

1. Open a project folder in VSCode.
2. Run `Personal Kanban: Init Board` — creates the `.personal-kanban/` folder.
3. Run `Personal Kanban: Open Board` to view the board.
4. Click **+ Add card** at the bottom of any column.
5. **Double-click** a card to edit it. Press `Ctrl+S` or click away to save. `Escape` to discard.
6. Drag cards between columns or reorder within a column.
7. Right-click (or click ⋮) a card for actions: view content, see metadata, copy ID, delete.
8. Use **Archive Done** to sweep completed cards into `archive/`.

### Tags

Write `#tagname` anywhere in a card's content. Tags are extracted at render time and displayed on the card. Configure tag colors and sort weights in VSCode settings (see below).

### Editing the board manually

Card files are plain text — open any `cards/{id}.md` in your editor and change the `column` field to move a card. The board refreshes automatically when the file is saved.

## VSCode Settings

`Init Board` writes default values to `.vscode/settings.json` for tags and display options. Scripts and hooks are stored in `manifest.json` itself.

### Tags

```json
"personal-kanban.tags": {
  "bug":     { "color": "#e11d48", "weight": 10 },
  "feature": { "color": "#2563eb", "weight":  5 },
  "chore":   { "color": "#6b7280", "weight":  1 },
  "urgent":  { "color": "#f97316", "weight": 20 }
}
```

`color` is a hex string used to tint the tag badge. `weight` controls sort order — higher weight cards float to the top of their column and win the dominant-tag color when using `card-border` or `card-background` mode.

### Tag color target

```json
"personal-kanban.tagColorTarget": "tag"
```

| Value | Effect |
|---|---|
| `tag` (default) | Colors the tag chip itself |
| `card-border` | Colors the card's left border using the dominant tag |
| `card-background` | Tints the card background using the dominant tag |

### Board folder name

```json
"personal-kanban.boardFolderName": ".personal-kanban"
```

Name of the folder where board data is stored. Change this if `.personal-kanban` conflicts with another tool.

> If you change this after `Init Board` has run, rename the existing folder to match.

### Show lead time

```json
"personal-kanban.showCardAge": true
```

When `true` (default), done cards display their **lead time** (creation → done) as a small badge. Set to `false` to hide it.

### Enable hooks

```json
"personal-kanban.enableHooks": true
```

Set to `false` to disable all hook script execution without removing your configuration.

## Hooks & Scripts

Scripts are Node.js files that run when board events occur. They receive a JSON payload via stdin and can read or update card files using the helpers in `lib.js`.

### Hook events

| Event | Payload fields |
|---|---|
| `card.created` | `card_id`, `card_title`, `column`, `card_path` |
| `card.edited` | `card_id`, `card_title`, `card_path` |
| `card.deleted` | `card_id`, `card_title`, `last_column` |
| `card.moved` | `card_id`, `card_title`, `from_column`, `to_column`, `branch`, `card_path` |
| `card.reviewed` | `card_id`, `card_title`, `from_column`, `branch` |
| `wip.violated` | `column`, `wip_limit`, `current_count`, `card_id` |
| `cards.archived` | `column` |

Every payload also includes `event` (the event name) and `timestamp` (ISO-8601).

### Reading and updating cards from scripts

`scripts/lib.js` provides helpers for working with card files:

```js
const { readPayload, readCard, updateCardMetadata, notify } = require('./lib');

readPayload('my-script', ({ card_path, card_title }) => {
  // Read all metadata from the card file
  const { metadata, content } = readCard(card_path);
  console.log(metadata.column, metadata.branch);

  // Patch one or more metadata fields without touching others
  updateCardMetadata(card_path, { my_field: 'my_value' });

  notify('Kanban', `"${card_title}" updated`);
});
```

Configure scripts and hooks in `manifest.json`:

```json
"scripts": {
  "my-script": { "file": "scripts/my-script.js" }
},
"hooks": {
  "card.moved": ["my-script"]
}
```

## Claude Code Integration

This project includes a `/personal-kanban` skill for [Claude Code](https://claude.ai/code). It lets Claude read and manage the board directly — no manual JSON editing required.

### Skill commands

| Command | Description |
|---|---|
| `/personal-kanban` | Show board status: all columns, card counts, and titles |
| `/personal-kanban list` | List all cards grouped by column with tag, title, and branch |
| `/personal-kanban start` | Move the top card from Refined (or Backlog) to In Progress |
| `/personal-kanban review` | Push branch, move active In Progress card to Review |
| `/personal-kanban done [title]` | Merge the card's branch, move card to Done |
| `/personal-kanban new #tag Title` | Create a new card directly in In Progress |
| `/personal-kanban raise #tag Title` | Raise a new card from a review finding |

### Workflow

```
Backlog → Refined → In Progress → Review → Done → (archive)
                        ↑                    ↓
                   branch saved         branch merged
                   to card metadata     and deleted
```

1. `/personal-kanban start` — picks the top refined card, creates a git branch, saves the branch name to `metadata.branch`.
2. Work is committed on the branch with small, focused commits.
3. `/personal-kanban review` — pushes the branch and moves the card to Review.
4. When satisfied, drag the card to Done or run `/personal-kanban done`.
5. `/personal-kanban done` — reads `metadata.branch`, merges into main, deletes the branch, and clears the branch field.
6. Use **Archive Done** to sweep completed cards out of view.

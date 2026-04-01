# Personal Kanban

A file-based personal kanban board for VSCode. The entire board state lives in plain text files inside your project — no database, no server, no account required.

## Features

- **Git-friendly** — one card changed = one file changed; commit your board alongside your code
- **File-based** — board state is human-readable Markdown you can edit directly in a pinch
- **AI-readable** — structured so an AI can understand board state without special tooling
- **Drag and drop** — move cards between columns and reorder within a column
- **Inline editing** — double-click any card to edit (markdown supported)
- **Tag system** — write `#tagname` anywhere in a card and tags appear automatically
- **Live sync** — editing `manifest.json` externally refreshes the board instantly
- **Hooks** — run Node.js scripts on board events (card moved, WIP exceeded, etc.)

## Commands

| Command | Description |
|---|---|
| `Personal Kanban: Init Board` | Creates `.personal-kanban/` in the workspace root with a default `manifest.json`, `cards/`, `archive/`, and `scripts/` folders |
| `Personal Kanban: Open Board` | Opens the Kanban board webview panel |

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type `Personal Kanban` to find both commands.

## Board Structure

Running `Personal Kanban: Init Board` creates:

```
{workspace-root}/
└── .personal-kanban/
    ├── manifest.json      ← source of truth for column order and card placement
    ├── GUIDELINES.md      ← editable workflow guidelines
    ├── cards/
    │   └── {id}.md        ← one file per active card
    ├── archive/
    │   └── {id}.md        ← archived cards (moved from Done)
    └── scripts/
        ├── lib.js          ← shared helpers (notify, readPayload)
        ├── card-created.js
        ├── card-edited.js
        ├── card-deleted.js
        ├── card-moved.js
        ├── card-reviewed.js
        ├── cards-archived.js
        └── wip-alert.js
```

The default columns are **Backlog**, **Refined**, **In Progress**, **Review**, and **Done**. To change column names, reorder, or add columns, edit `manifest.json` directly.

### manifest.json shape

```json
{
  "version": 4,
  "name": "my-project",
  "columns": [
    { "id": "backlog",     "label": "Backlog",      "wip_limit": null, "cards": [] },
    { "id": "refined",     "label": "Refined",      "wip_limit": null, "cards": [] },
    { "id": "in-progress", "label": "In Progress",  "wip_limit": 1,    "cards": ["20260326-b7c2"] },
    { "id": "review",      "label": "Review",       "wip_limit": null, "cards": [] },
    { "id": "done",        "label": "Done",          "wip_limit": null, "cards": [] }
  ]
}
```

Card IDs are stored directly in each column's `cards` array. `wip_limit` triggers a `wip.violated` hook event when a column exceeds its limit.

> **Note:** `tags`, `scripts`, and `hooks` are read from VSCode settings (`.vscode/settings.json`) and are not stored in `manifest.json`.

### Card file shape

Cards live in `cards/{id}.md` as YAML frontmatter followed by a Markdown body:

```
---
id: 20260326-b7c2
created_at: 2026-03-26T10:00:00.000Z
updated_at: 2026-03-26T10:00:00.000Z
branch: feature/card-title
---

#feature

# Card title

Description text.
```

- The first line of the body should be space-separated `#tags`.
- The card title is the first H1 (`#`) heading.
- `branch` is set when work begins on a card and cleared after the branch is merged.
- Archived cards are identical in format and live in `archive/{id}.md`.

### Card IDs

Cards are identified by `YYYYMMDD-xxxx` (UTC date + 4 random hex chars), e.g. `20260326-b7c2`.

## Usage

1. Open a project folder in VSCode.
2. Run `Personal Kanban: Init Board` — creates the `.personal-kanban/` folder.
3. Run `Personal Kanban: Open Board` to view the board.
4. Click **+ Add card** at the bottom of any column to create a card.
5. **Single-click** a card to read it. **Double-click** to edit.
6. Press `Ctrl+S` or click away to save. Press `Escape` to discard changes.
7. Drag cards between columns or reorder within a column.
8. Hover a card and click the delete button to remove it (confirmation required).
9. Use the **Archive Done** button to move all Done cards to `archive/`.

### Tags

Add `#tagname` anywhere in a card's content. Tags are extracted at render time and displayed on the card face. Configure tag colors and sort weights in VSCode settings (see below).

### Editing the board manually

`manifest.json` is the source of truth. You can edit it directly — the board refreshes automatically when the file changes.

## VSCode Settings

`Init Board` writes default values to `.vscode/settings.json` if not already present.

### Tags

```json
"personal-kanban.tags": {
  "bug":     { "color": "#e11d48", "weight": 10 },
  "feature": { "color": "#2563eb", "weight":  5 },
  "chore":   { "color": "#6b7280", "weight":  1 },
  "urgent":  { "color": "#f97316", "weight": 20 }
}
```

`color` is a hex string used to tint the tag badge. `weight` controls sort order — higher weight cards sort to the top of their column.

### Scripts & Hooks

Scripts are Node.js files that receive a JSON event payload via stdin. Define them under `personal-kanban.scripts` and bind them to events under `personal-kanban.hooks`:

```json
"personal-kanban.scripts": {
  "card-moved":     { "file": "scripts/card-moved.js" },
  "card-reviewed":  { "file": "scripts/card-reviewed.js" },
  "wip-alert":      { "file": "scripts/wip-alert.js" }
},
"personal-kanban.hooks": {
  "card.moved":    ["card-moved"],
  "card.reviewed": ["card-reviewed"],
  "wip.violated":  ["wip-alert"]
}
```

All paths are relative to `.personal-kanban/`.

#### Hook events

| Event | Payload fields |
|---|---|
| `card.created` | `card_id`, `card_title`, `column` |
| `card.edited` | `card_id`, `card_title` |
| `card.deleted` | `card_id`, `card_title`, `last_column` |
| `card.moved` | `card_id`, `card_title`, `from_column`, `to_column`, `branch` |
| `card.reviewed` | `card_id`, `card_title`, `from_column`, `branch` |
| `wip.violated` | `column_id`, `wip_limit`, `current_count` |
| `cards.archived` | `column` |

Every payload also includes `event` (the event name) and `timestamp` (ISO-8601).

The sample scripts in `scripts/` show how to read the payload and fire OS notifications using `scripts/lib.js`. Customize them freely.

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
3. `/personal-kanban review` — pushes the branch and moves the card to Review. The branch is **not merged yet**.
4. You review the work in your own time. When satisfied, drag the card to Done or run `/personal-kanban done`.
5. `/personal-kanban done` — reads `metadata.branch` from the card, merges into main, deletes the branch, and clears the branch field.
6. Use **Archive Done** to sweep completed cards out of view.

Multiple cards can be in Review simultaneously, each with their own branch tracked in `metadata.branch`.

## Development

### Prerequisites

- Node.js 18+
- VSCode 1.85+

### Setup

```bash
npm install
npm run build
```

### Available scripts

| Script | Description |
|---|---|
| `npm run build` | Compile extension to `dist/extension.js` |
| `npm run watch` | Rebuild on file changes |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Type-check without emitting |

### Running locally (F5 debug)

1. Open this repository in VSCode.
2. Press `F5` — this launches an **Extension Development Host** window.
3. In that new window, open any folder, then run the `Personal Kanban:` commands.

### Packaging and installing the VSIX

Install the VSCode Extension CLI if you don't have it:

```bash
npm install -g @vscode/vsce
```

Package the extension:

```bash
vsce package
# produces personal-kanban-{version}.vsix
```

Install the `.vsix` file:

```bash
code --install-extension personal-kanban-{version}.vsix
```

Or in VSCode: open the Extensions sidebar → `...` menu → **Install from VSIX...** → select the file.

## Source layout

```
src/
├── extension.ts   — activation, command registration, Init Board scaffold
├── BoardPanel.ts  — webview panel (HTML, CSS, JS, message handling)
├── hooks.ts       — hook dispatcher: reads scripts/hooks from manifest, spawns Node scripts
├── io.ts          — file I/O: manifest reader/writer, card reader/writer, file watcher
└── types.ts       — TypeScript interfaces for manifest and card shapes
```

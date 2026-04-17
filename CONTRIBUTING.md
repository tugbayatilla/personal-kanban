# Contributing & Development

This document covers the internal architecture, data formats, and development workflow for the Personal Kanban VSCode extension.

## Prerequisites

- Node.js 18+
- VSCode 1.85+

## Setup

```bash
npm install
npm run build
```

## Available scripts

| Script | Description |
|---|---|
| `npm run build` | Compile extension to `dist/extension.js` |
| `npm run watch` | Rebuild on file changes |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Type-check without emitting |

## Running locally (F5 debug)

1. Open this repository in VSCode.
2. Press `F5` — launches an **Extension Development Host** window.
3. In that window, open any folder, then run the `Personal Kanban:` commands.

## Deploy script

`scripts/deploy.sh` handles both local installs and marketplace publishing.

**Local install (dev build)**

```bash
./scripts/deploy.sh
```

Packages the extension under the name `personal-kanban-dev` / `Personal Kanban (Dev)` and installs it locally. Because the extension ID differs from the published version (`TGBY.personal-kanban` vs `TGBY.personal-kanban-dev`), both can be active simultaneously in VSCode — useful for comparing dev changes against the released build.

**Publish to marketplace**

```bash
./scripts/deploy.sh --publish
```

Runs typecheck + lint + build, bumps the patch version, publishes to the VS Code Marketplace using `AZURE_PAT` from `.env`, then commits the version bump. Requires a `.env` file at the repo root:

```
AZURE_PAT=your_pat_here
```

`vsce` is installed automatically if missing.

---

## Source layout

```
src/
├── extension.ts   — activation, command registration, Init Board scaffold, script templates
├── BoardPanel.ts  — webview panel lifecycle, message handling, all card operations
├── hooks.ts       — hook dispatcher: spawns Node scripts with JSON payloads via stdin
├── io.ts          — all file I/O: manifest, cards, ordering, board state assembly
└── types.ts       — TypeScript interfaces (Manifest, Column, Card, CardMetadata, messages)

media/
├── board.js       — webview frontend: rendering, drag-and-drop, editing, context menu
└── board.css      — webview styles

resources/
└── GUIDELINES.md  — template copied into .personal-kanban/ on Init Board
```

---

## Architecture

### Core principle: card-centric state

Board state is derived from card files, not from the manifest. On every load, `loadBoardState()` scans all `cards/*.md` files and groups them into columns using the `column` field in each card's frontmatter. The manifest stores column definitions (structure), scripts, and hooks — nothing about which cards are where.

**What lives where:**

| Data | Location |
|---|---|
| Column structure (id, label, index, wip_limit, rules) | `manifest.json` |
| Scripts and hooks | `manifest.json` |
| Card content | `cards/{id}.md` — markdown body |
| Card column membership | `cards/{id}.md` — `column:` frontmatter field |
| Card position within column | `cards/{id}.md` — `order:` frontmatter field |
| Tags, tagColorTarget, showCardAge | VSCode workspace settings |

### Board load flow

```
openBoard
  └── loadBoardState(boardRoot)
        ├── readManifest()           — reads manifest.json, overlays VSCode settings for tags etc.
        ├── fs.readdirSync(cards/)   — scans all .md files
        ├── parseCardMd() × N        — parses each card's frontmatter + body
        ├── group by card.metadata.column
        ├── sort each group by card.metadata.order (ascending; lower = top)
        └── attach sorted card ID arrays to manifest.columns[].cards (in-memory only)
```

The resulting `manifest.columns[].cards` arrays are **never written to disk** — they exist only in the object passed to the webview. `writeManifest()` strips them before serializing.

### Card operations

| Operation | What changes on disk |
|---|---|
| Add card | New `cards/{id}.md` with `column` and `order` set |
| Save card (edit) | Updated `cards/{id}.md` content, metadata unchanged |
| Move card | Updated `cards/{id}.md` — only `column` and `order` change; no other cards touched |
| Delete card | `cards/{id}.md` deleted |
| Archive done | Each done `cards/{id}.md` gets `archived_at` stamped, then moved to `archive/{id}.md` |

The manifest is **never written** during normal card operations. Only `Init Board` writes it.

### Midpoint / fractional ordering

Cards within a column are ordered by a decimal `order` value in the range (0, 1). Lower = higher position (top of column). When a card is inserted at position `i` among a sorted list:

```
prevOrder = order of card at i-1  (or 0 if inserting at top)
nextOrder = order of card at i    (or 1 if inserting at bottom)
newOrder  = (prevOrder + nextOrder) / 2
```

Examples:

| Scenario | Calculation | Result |
|---|---|---|
| First card in empty column | (0 + 1) / 2 | 0.5 |
| Second card after 0.5 | (0.5 + 1) / 2 | 0.75 |
| Card inserted between 0.5 and 0.75 | (0.5 + 0.75) / 2 | 0.625 |

Only the moved card's `order` field is updated — no other cards are modified. JavaScript doubles give ~15 significant digits, allowing ~50 successive midpoint subdivisions before values become indistinguishable. In practice this is never a concern.

`calcOrder(prev, next)` in `io.ts` implements the formula.

### Hook system

When a board event occurs, `fireHook()` in `hooks.ts`:
1. Reads `manifest.hooks[event]` for the list of script names to run.
2. Looks up each script's file path in `manifest.scripts`.
3. Spawns `node <script>` as a child process with `cwd = boardRoot`.
4. Sends the JSON payload to the process via stdin.

Scripts are fire-and-forget — the extension does not wait for them. Script stdout/stderr is captured and logged to the **Personal Kanban** output channel.

The extension always writes `column` and `order` to the card synchronously before firing hooks, so hook scripts receive an already-updated card file. The `card-moved.js` template demonstrates how to call `updateCardMetadata()` from a script for additional custom writes.

**All hook payloads include `card_path`** (relative to board root) for `card.created`, `card.edited`, and `card.moved` — the events where the card file still exists. Scripts can use `readCard(card_path)` and `updateCardMetadata(card_path, updates)` from `lib.js` to read and modify any metadata field.

### File watchers

`BoardPanel` watches two glob patterns:
- `manifest.json` — reloads the board when column structure / scripts / hooks are edited externally.
- `cards/*.md` — reloads the board when any card file is edited externally (e.g. a script updated `column:`, a developer changed frontmatter in the editor).

A timestamp-based suppression window (`_suppressWatchUntil`) prevents the watcher from triggering a reload in response to the extension's own writes. The window is set to `Date.now() + 1000ms` before any write operation.

### Manifest migration

`readManifest()` handles legacy formats transparently:
- **v3** (object-format columns) → converted to v1 Column array.
- **v4** (array columns with `cards: string[]` per column) → `cards` arrays are stripped; `scripts`/`hooks` are migrated from VSCode settings into the manifest if absent.
- **v1** (current) — read as-is.

Migration is in-memory only. The manifest file is not rewritten until the next explicit `writeManifest()` call (i.e. `Init Board`).

---

## Data formats

### manifest.json (v1)

```json
{
  "version": 1,
  "name": "project-name",
  "columns": [
    {
      "id": "backlog",
      "label": "Backlog",
      "index": 0,
      "wip_limit": null,
      "rules": {}
    }
  ],
  "scripts": {
    "card-moved": { "file": "scripts/card-moved.js" }
  },
  "hooks": {
    "card.moved": ["card-moved"]
  }
}
```

`tags`, `tagColorTarget`, and `showCardAge` are **not** stored here — they are overlaid from VSCode settings at read time and stripped at write time.

### Card frontmatter (v1)

```
---
id: 20260326-b7c2
created_at: 2026-03-26T10:00:00.000Z
column: in-progress
order: 0.5
active_at: 2026-03-27T09:00:00.000Z
done_at:
branch: feature/my-feature
archived_at:
---
```

**Known fields** (handled by `parseCardMd` / `serializeCardMd` in `io.ts`):

| Field | Type | Description |
|---|---|---|
| `id` | string | `YYYYMMDD-xxxx` — written to frontmatter but also carried on `Card.id` |
| `created_at` | ISO-8601 | Set on creation; never changed |
| `column` | string | Column id this card belongs to; defaults to first column if absent |
| `order` | decimal string | Position within column (0–1); lower = top |
| `active_at` | ISO-8601 | Stamped when first moved to `in-progress` |
| `done_at` | ISO-8601 | Stamped when moved to `done` |
| `branch` | string | Git branch name |
| `archived_at` | ISO-8601 | Stamped when archived |

Any additional frontmatter fields are preserved through read/write cycles and surfaced in the metadata popup.

### TypeScript interfaces

```typescript
interface Column {
  id: string;
  label: string;
  index: number;
  wip_limit: number | null;
  rules: Record<string, unknown>;
  cards?: string[];   // in-memory only; not in manifest.json
}

interface CardMetadata {
  created_at: string;
  column?: string;
  order?: string;
  active_at?: string;
  done_at?: string;
  branch?: string;
  archived_at?: string;
  [key: string]: string | undefined;  // custom fields
}

interface Card {
  id: string;
  content: string;     // markdown body (after frontmatter)
  metadata: CardMetadata;
}
```

---

## Webview ↔ extension messages

Messages flow via `vscode.postMessage` / `webview.onDidReceiveMessage`.

**Webview → extension:**

| `type` | Fields | Description |
|---|---|---|
| `ready` | — | Webview loaded; request initial state |
| `addCard` | `columnId` | Create a new card in this column |
| `saveCard` | `id`, `content` | Save edited card content |
| `deleteCard` | `id` | Delete a card |
| `moveCard` | `id`, `fromColumn`, `toColumn`, `toIndex` | Move card; `toIndex` is insertion position in destination |
| `archiveDone` | — | Archive all done cards |

**Extension → webview:**

| `type` | Fields | Description |
|---|---|---|
| `setState` | `manifest`, `cards`, `editCardId?` | Full board state; `editCardId` opens that card in edit mode |
| `setState` | `manifest: null`, `cards: {}`, `error` | Error state (board not initialized or read failure) |

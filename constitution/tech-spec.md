# Tech Spec

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.3 (strict) | Type safety in extension host; no transpiler needed for webview |
| Runtime | Node.js 18+ / VSCode Extension Host | Extension host; scripts also run on Node.js 18+ |
| Bundler | esbuild | Fast; single-file output for extension host; no bundling for webview |
| Test runner | Jest 30 + ts-jest | Real filesystem integration tests; no mocking of I/O |
| Linter | ESLint 8 + @typescript-eslint | Enforces conventions; no Prettier (formatting is a non-issue) |
| Production deps | None | No npm packages at runtime; VSCode API + Node.js stdlib only |

The webview frontend (`media/board.js`) is **plain JavaScript** — no framework, no build step. It communicates with the extension host via `acquireVsCodeApi().postMessage`.

---

## Architecture

```
VSCode Extension Host
├── extension.ts      — activation, command registration, Init Board scaffold
├── BoardPanel.ts     — webview lifecycle, message dispatch, card I/O coordination
├── hooks.ts          — hook dispatcher (spawn node scripts, send JSON via stdin)
├── io.ts             — all file I/O: manifest, cards, board state assembly, locking, ordering
└── types.ts          — TypeScript interfaces

VSCode Webview (sandboxed)
└── media/board.js    — rendering, drag-and-drop, inline editing, context menu
    media/board.css   — VSCode theme-aware styling
```

### Key invariant: card-centric state

Board state is **derived from card files on every load** — it is never persisted in the manifest. When the board opens, `loadBoardState()` reads every `cards/*.md` file, groups them by their `column:` frontmatter field, and sorts each group by `order:`. The manifest stores only column structure, scripts, and hooks.

This means:
- External edits to card files are always reflected on reload or file-watcher event.
- The manifest never becomes out of sync with card positions.
- Cards can be moved by editing a single file field.

---

## Data Format

### Directory layout

```
.personal-kanban/
├── manifest.json          — column definitions, scripts, hooks
├── GUIDELINES.md          — editable workflow policies
├── cards/
│   └── {YYYYMMDD-xxxx}.md — one file per active card
├── archive/
│   └── {YYYYMMDD-xxxx}.md — archived cards swept from Done
└── scripts/
    ├── lib.js             — shared helpers
    ├── card-created.js
    ├── card-edited.js
    ├── card-deleted.js
    ├── card-moved.js
    ├── card-reviewed.js
    ├── cards-archived.js
    └── wip-alert.js
```

### manifest.json (schema v1)

```json
{
  "version": 1,
  "name": "my-project",
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

Fields:
- `version` — schema version; currently `1`. Migration runs on load when an older version is detected.
- `name` — display name for the board.
- `columns[].id` — stable identifier used in card frontmatter; never change after creation.
- `columns[].index` — left-to-right render order.
- `columns[].wip_limit` — integer or `null`. When a column's card count exceeds this value after a move, `wip.violated` fires.
- `columns[].rules` — reserved for future automation; currently ignored.
- `scripts` — map of script name → `{ file: relative-path }`. Paths are relative to the board root.
- `hooks` — map of event name → ordered array of script names to execute.

Fields **not** stored in the manifest (they come from VSCode workspace settings):
- `tags` — tag color/weight configuration
- `tagColorTarget` — how tag colors are applied
- `showCardAge` — whether to show lead time badge

### Card file format (frontmatter v1)

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

#feature #urgent

# Card title

Markdown body.
```

Known frontmatter fields:

| Field | Type | Set by | Notes |
|---|---|---|---|
| `id` | string | Extension on creation | `YYYYMMDD-xxxx`; UTC date + 4 random hex chars |
| `created_at` | ISO-8601 | Extension on creation | Never modified after creation |
| `column` | string | Extension on move | Must match a column `id` in manifest; defaults to first column |
| `order` | decimal string | Extension on move/create | Decimal in (0, 1); lower = higher position in column |
| `active_at` | ISO-8601 or empty | Extension | Stamped when first moved to `in-progress` |
| `done_at` | ISO-8601 or empty | Extension | Stamped when moved to `done` |
| `branch` | string or empty | Extension / user | Git branch name associated with this card |
| `archived_at` | ISO-8601 or empty | Extension | Stamped when archived |

Any additional frontmatter fields the user adds are preserved on all writes and shown in the metadata popup.

### Card ordering (midpoint / fractional indexing)

When inserting a card at position `i` in a column:

```
prevOrder = order of card at i-1  (or 0 if inserting at top)
nextOrder = order of card at i    (or 1 if inserting at bottom)
newOrder  = (prevOrder + nextOrder) / 2
```

Only the moved card's file is written — no other cards are touched. IEEE 754 doubles provide ~15 significant digits, allowing ~50 successive midpoint subdivisions from the same gap before precision loss. This is sufficient for all practical use.

---

## Hook System

### Dispatch flow

1. A board event occurs (card moved, WIP exceeded, etc.).
2. `BoardPanel.ts` calls `dispatchHook(event, payload, boardRoot, manifest)`.
3. `hooks.ts` looks up `manifest.hooks[event]` for script names.
4. For each script name in order, `hooks.ts` resolves the file path from `manifest.scripts[name].file`.
5. Spawns `node <scriptPath>` with `cwd = boardRoot`.
6. Writes the JSON payload to stdin and closes stdin.
7. Logs stdout/stderr to the **Personal Kanban** output channel.
8. If exit code ≠ 0, the script chain stops and remaining scripts do not run.
9. Scripts are fire-and-forget — the extension does not await completion before continuing.

### Hook events and payloads

Every payload includes `event` (event name string) and `timestamp` (ISO-8601). The `notifications` boolean (from `personal-kanban.notifications` setting) is also included so scripts can decide whether to show OS notifications.

| Event | Extra payload fields |
|---|---|
| `card.created` | `card_id`, `card_title`, `column`, `card_path` |
| `card.edited` | `card_id`, `card_title`, `card_path` |
| `card.deleted` | `card_id`, `card_title`, `last_column` |
| `card.moved` | `card_id`, `card_title`, `from_column`, `to_column`, `branch`, `card_path` |
| `card.reviewed` | `card_id`, `card_title`, `from_column`, `branch` |
| `wip.violated` | `column`, `wip_limit`, `current_count`, `card_id` |
| `cards.archived` | `column` |

### lib.js helpers

`scripts/lib.js` is copied into each board on init. It provides:

```js
readPayload(scriptName, callback)
// Reads stdin, parses JSON, calls callback(payload). Exits on error.

readCard(cardPath) → { metadata, content }
// Parses YAML frontmatter + Markdown body from a card file.

updateCardMetadata(cardPath, patch)
// Merges patch into existing frontmatter and writes the file.
// All other fields and the Markdown body are preserved.

notify(title, message)
// Sends an OS notification via node-notifier (bundled in lib.js via inline require).
```

---

## File I/O Guarantees

### Locking

All manifest writes use `withLock(boardRoot, fn)`:

1. Acquires `manifest.lock` using `fs.openSync` with `O_EXCL` (atomic OS-level exclusion).
2. Runs `fn()`.
3. Releases the lock by deleting `manifest.lock`.

This prevents concurrent manifest writes from the extension host and external processes (e.g. scripts, AI agents).

### Write semantics

- Card writes: read full file → patch frontmatter or body → write full file. Frontmatter fields not in the patch are preserved.
- Manifest writes: strip in-memory-only fields (`tags`, column `cards` arrays) before serializing.
- Archive: rename `cards/{id}.md` → `archive/{id}.md`, stamp `archived_at`.

---

## VSCode Settings Reference

| Setting | Type | Default | Description |
|---|---|---|---|
| `personal-kanban.tags` | object | `{}` | Tag name → `{ color: string, weight: number }` |
| `personal-kanban.tagColorTarget` | enum | `"tag"` | `"tag"` \| `"card-border"` \| `"card-background"` |
| `personal-kanban.boardFolderName` | string | `".personal-kanban"` | Board data directory name |
| `personal-kanban.enableHooks` | boolean | `true` | Disable hook script execution globally |
| `personal-kanban.notifications` | boolean | `true` | Pass notification flag to hook scripts |
| `personal-kanban.showCardAge` | boolean | `true` | Show lead time badge on done cards |

Settings are overlaid onto the manifest at read time. They are not written into `manifest.json`.

---

## Webview ↔ Extension Host Protocol

Messages from webview to extension host (`WebviewMessage`):

| type | Payload |
|---|---|
| `addCard` | `column`, `content` |
| `saveCard` | `id`, `content` |
| `deleteCard` | `id` |
| `moveCard` | `id`, `toColumn`, `afterId` (card to insert after, or null) |
| `archiveDone` | — |
| `openCardFile` | `id` |
| `ready` | — |

Messages from extension host to webview (`ExtensionMessage`):

| type | Payload |
|---|---|
| `board` | Full board state (manifest + columns with cards) |

---

## Testing

Tests live in `src/__tests__/` and run with `jest`. All integration tests use real temporary directories — there is no mocking of the filesystem.

Test areas:
- `io.test.ts` — manifest read/write, card parsing, board state assembly, archiving
- `ordering.test.ts` — midpoint ordering, edge cases
- `hooks.test.ts` — hook dispatch, script spawning, sequential execution, exit-code abort
- `board-operations.test.ts` — full board operation sequences (add, move, delete, archive)

Run: `npm test`

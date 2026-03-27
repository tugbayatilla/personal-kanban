# MVP 1 — Personal Kanban VSCode Extension

**Scope:** Minimal working board. Create, view, edit, delete, and move cards. No archive, no logs, no hooks, no WIP limits, no colors.

---

## Decisions

| Topic | Decision |
|---|---|
| Board UI | Webview panel |
| Card movement | Drag and drop between columns |
| Card editing | Inline, double-click to edit (markdown-supported textarea), single-click = read-only |
| Card creation | "+ Add card" button at bottom of each column, appends to bottom |
| Tags | Parsed from `#tagname` tokens in content and displayed on card. No color/weight system. |
| Columns | Fixed defaults: Backlog, In Progress, Review, Done. Editable only via `manifest.json` directly. |
| Board init | `Kanban: Init Board` command creates `.personal-kanban/` folder inside the workspace root |
| Archive | Not in MVP 1 |
| Logs | Not in MVP 1 |
| Hooks | Not in MVP 1 |
| WIP limits | Not in MVP 1 |

---

## Folder structure created by Init

```
{workspace-root}/
└── .personal-kanban/
    ├── manifest.json
    └── cards/
```

---

## Tasks

### M1 — Project Scaffold

| ID | Task | Description |
|---|---|---|
| ~~M1-01~~ ✓ | ~~Initialise extension project~~ | Create VSCode extension with TypeScript. Set up `tsconfig.json`, `package.json`, ESLint, and build pipeline (`esbuild` or `tsc`). |
| ~~M1-02~~ ✓ | ~~Extension entry point~~ | Register activation event. Extension activates when a workspace folder is open. |
| ~~M1-03~~ ✓ | ~~`Kanban: Init Board` command~~ | Create `.personal-kanban/` folder and `cards/` subfolder in workspace root. Write a valid default `manifest.json` with 4 default columns and empty cards arrays. Do nothing if folder already exists — show info message instead. |

---

### M2 — Core File I/O

| ID | Task | Description |
|---|---|---|
| ~~M2-01~~ ✓ | ~~Manifest reader~~ | Read and parse `.personal-kanban/manifest.json`. Return typed data structure. Show error if file is missing or invalid JSON. |
| ~~M2-02~~ ✓ | ~~Manifest writer~~ | Write `manifest.json` atomically (write to temp file, rename). |
| ~~M2-03~~ ✓ | ~~Card reader~~ | Read a single `cards/{id}.json` by ID. Return typed card object. |
| ~~M2-04~~ ✓ | ~~Card writer~~ | Write a card file atomically. Always update `metadata.updated_at` on write. |
| ~~M2-05~~ ✓ | ~~Card ID generator~~ | Generate IDs in `YYYYMMDD-xxxx` format (UTC date + 4 random hex chars). |
| ~~M2-06~~ ✓ | ~~Manifest file watcher~~ | Watch `.personal-kanban/manifest.json` for external changes. Trigger board refresh on change. |

---

### M3 — Board Webview

| ID | Task | Description |
|---|---|---|
| ~~M3-01~~ ✓ | ~~`Kanban: Open Board` command~~ | Open a webview panel titled "Kanban Board". Register command in `package.json`. |
| ~~M3-02~~ ✓ | ~~Column rendering~~ | Render columns left-to-right from `manifest.json → columns` array. Show column label and card count. |
| ~~M3-03~~ ✓ | ~~Card rendering (read mode)~~ | Render each card in column order. Show title (first line of `content`, `#` stripped) and tags (`#tagname` tokens found in content). |
| ~~M3-04~~ ✓ | ~~"+ Add card" button~~ | Each column has a "+ Add card" button at the bottom. Clicking it creates a new blank card in that column and appends it to the bottom of the column list. |
| ~~M3-05~~ ✓ | ~~Inline card editing~~ | Single-click = read-only view. Double-click = editable textarea (markdown supported). On blur or Ctrl+S: save content to card file and update manifest if needed. On Escape: discard changes. |
| ~~M3-06~~ ✓ | ~~Card deletion~~ | Each card has a delete button (visible on hover). Show confirmation. On confirm: remove card from manifest, delete `cards/{id}.json`. |
| ~~M3-07~~ ✓ | ~~Drag and drop~~ | Cards are draggable between columns and within a column. On drop: update manifest (remove from source column array, insert at target position). Persist manifest. |
| ~~M3-08~~ ✓ | ~~Board refresh~~ | When manifest watcher fires, re-render the board without losing scroll position. Also re-render after every write operation. |

---

### M4 — Tag Display

| ID | Task | Description |
|---|---|---|
| ~~M4-01~~ ✓ | ~~Tag extraction~~ | At render time, scan card `content` for `#tagname` tokens. Extract as tag list. |
| ~~M4-02~~ ✓ | ~~Tag chips on card~~ | Display extracted tags as small chips/badges at the bottom of each card in read mode. No color yet — plain style only. |

---

### M5 — Consistency & Edge Cases

| ID | Task | Description |
|---|---|---|
| ~~M5-01~~ ✓ | ~~Missing card file~~ | If manifest references a card ID with no file in `cards/`, show a placeholder "broken card" in the UI. Do not crash. |
| ~~M5-02~~ ✓ | ~~Empty board state~~ | If manifest has no cards in any column, show an empty state message per column ("No cards yet"). |
| ~~M5-03~~ ✓ | ~~Atomic writes~~ | All manifest and card writes use temp-file-then-rename pattern. |

---

## Out of Scope for MVP 1

- Archive / archive view
- Log files and log viewer
- Hook & script system
- WIP limits and WIP warnings
- Tag colors and weight system
- Column management UI (add / rename / reorder / delete)
- History files and cycle/lead time metrics
- Metrics view
- `.gitignore` helper
- Extension settings

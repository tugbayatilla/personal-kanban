# File-Based Kanban System — Development Document

**Version:** 1.0  
**Status:** In Planning  
**Target:** Solo developer, VSCode extension (first UI)

---

## Table of Contents

1. [Vision & Goals](#1-vision--goals)
2. [System Overview](#2-system-overview)
3. [Folder Structure](#3-folder-structure)
4. [File Specifications](#4-file-specifications)
   - 4.1 [manifest.json](#41-manifestjson)
   - 4.2 [Card File](#42-card-file-cardsid json)
   - 4.3 [History File](#43-history-file-cardsid-historyjson)
   - 4.4 [Archive](#44-archive)
   - 4.5 [Log Files](#45-log-files-logsyyyy-mm-ddlog)
5. [Kanban Methodologies](#5-kanban-methodologies)
   - 5.1 [WIP Limits](#51-wip-limits)
   - 5.2 [Cycle Time & Lead Time](#52-cycle-time--lead-time)
6. [Tag System](#6-tag-system)
7. [Hook & Script System](#7-hook--script-system)
8. [Extension Behaviour Rules](#8-extension-behaviour-rules)
9. [VSCode Extension](#9-vscode-extension)
10. [Development Tasks](#10-development-tasks)

---

## 1. Vision & Goals

A **git-friendly, file-based Kanban system** where the entire board state lives in plain JSON files — no database, no server, no account required. The board lives alongside your code in a folder inside your project.

**Core principles:**
- The file format is the product. Any UI (VSCode, web, CLI) can implement it by reading the spec.
- Minimal schema. Every field earns its place.
- AI-readable by design. The manifest and card files are structured so an AI can understand the board state without any special tooling — but zero AI features are built in.
- Human-writable. In a pinch, a developer can edit JSON directly and the board stays valid.
- Git-friendly. One card changed = one file changed. History files are optional and deletable.

**Primary user:** Solo developer (personal productivity).

---

## 2. System Overview

```
┌─────────────────────────────────────────────────────┐
│                  manifest.json                      │
│  Board name, version, columns, tags, cards, hooks   │
│  ← SOURCE OF TRUTH for placement & order            │
└────────────────────┬────────────────────────────────┘
                     │ references card IDs
          ┌──────────▼──────────┐
          │     cards/          │
          │  {id}.json          │  ← card content
          │  {id}-history.json  │  ← journey (optional)
          └─────────────────────┘

          ┌─────────────────────┐
          │     archive/        │
          │  {id}.json          │  ← archived card content
          │  {id}-history.json  │  ← archived journey (optional)
          └─────────────────────┘

          ┌─────────────────────┐
          │     logs/           │
          │  2026-03-26.log     │  ← daily append-only log
          └─────────────────────┘

          ┌─────────────────────┐
          │     scripts/        │
          │  notify.sh          │  ← user-defined hook scripts
          │  sync.py            │
          └─────────────────────┘
```

The **manifest is the source of truth** for card placement, column order, and card order within columns. Card files hold content. If the two ever disagree on placement, the manifest wins and the extension self-heals the card file silently.

---

## 3. Folder Structure

```
my-project-kanban/
├── manifest.json
├── cards/
│   ├── 20260326-b7c2.json
│   └── 20260326-b7c2-history.json      ← optional, freely deletable
├── archive/
│   ├── 20260310-a3f9.json
│   └── 20260310-a3f9-history.json
├── logs/
│   ├── 2026-03-25.log
│   └── 2026-03-26.log
└── scripts/
    ├── notify.sh
    └── sync.py
```

**Rules:**
- The `my-project-kanban/` folder name is user-defined. The extension detects a board by the presence of a valid `manifest.json` inside.
- Every card always has exactly one `.json` file in `cards/`. The `-history.json` sibling is optional.
- The `archive/` folder mirrors the `cards/` folder structure exactly. No sub-folders.
- The `logs/` folder contains one file per calendar day, created on first event of that day.
- The `scripts/` folder contains user-written executables. Any language is valid.

---

## 4. File Specifications

### 4.1 `manifest.json`

The manifest is the index and configuration of the entire board.

```json
{
  "version": 1,
  "name": "my-project",
  "columns": [
    { "id": "backlog",      "label": "Backlog",      "wip_limit": null },
    { "id": "in-progress",  "label": "In Progress",  "wip_limit": 3    },
    { "id": "review",       "label": "Review",       "wip_limit": 2    },
    { "id": "done",         "label": "Done",         "wip_limit": null }
  ],
  "tags": {
    "blocker": { "color": "#e74c3c", "weight": 1.0 },
    "bug":     { "color": "#e67e22", "weight": 0.8 },
    "feature": { "color": "#3498db", "weight": 0.5 },
    "docs":    { "color": "#95a5a6", "weight": 0.2 }
  },
  "cards": {
    "backlog":     ["20260320-a1b2", "20260321-c3d4"],
    "in-progress": ["20260326-b7c2", "20260325-e5f6"],
    "review":      ["20260318-g7h8"],
    "done":        []
  },
  "hooks": {
    "card.moved":    ["scripts/notify.sh"],
    "card.created":  ["scripts/log_card.py"],
    "card.deleted":  [],
    "card.archived": ["scripts/notify.sh"],
    "wip.violated":  ["scripts/wip_alert.sh"],
    "tag.added":     [],
    "tag.removed":   [],
    "card.due":      []
  }
}
```

**Field rules:**

| Field                 | Type            | Notes                                                                                               |
| --------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| `version`             | integer         | Increments on breaking schema changes. Currently `1`.                                               |
| `name`                | string          | Human-readable board name. No uniqueness requirement.                                               |
| `columns`             | array           | Ordered array. UI renders columns left-to-right in this order.                                      |
| `columns[].id`        | slug string     | Lowercase, hyphenated. Immutable once set — used as key in `cards`.                                 |
| `columns[].label`     | string          | Display name. Mutable.                                                                              |
| `columns[].wip_limit` | integer or null | `null` means no limit.                                                                              |
| `tags`                | object          | Keys are tag name strings. Values define color and weight.                                          |
| `tags[].color`        | hex string      | e.g. `"#e74c3c"`. Used to color cards carrying this tag.                                            |
| `tags[].weight`       | float 0.0–1.0   | Determines which tag wins when a card has multiple tags. Highest wins.                              |
| `cards`               | object          | Keys are column slugs. Values are ordered arrays of card IDs. Array order = visual order in column. |
| `hooks`               | object          | Keys are event names. Values are arrays of script paths relative to the board root.                 |

---

### 4.2 Card File (`cards/{id}.json`)

Card IDs follow the format `YYYYMMDD-xxxx` where `xxxx` is 4 random lowercase hex characters (e.g. `20260326-b7c2`). IDs are assigned at creation and never change.

```json
{
  "id": "20260326-b7c2",
  "content": "# Implement login flow\n\nMarkdown content here.\n\n- step one\n- step two\n\n#bug #feature",
  "metadata": {
    "created_at": "2026-03-26T10:00:00Z",
    "updated_at": "2026-03-26T14:32:00Z"
  }
}
```

**Field rules:**

| Field                 | Type            | Notes                                                                                     |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `id`                  | string          | Matches filename. Set once at creation. Never changed.                                    |
| `content`             | string          | Full card content as raw markdown. Title, body, and tags all live here.                   |
| `metadata.created_at` | ISO 8601 string | Set by extension at creation. Never overwritten.                                          |
| `metadata.updated_at` | ISO 8601 string | Updated by extension on every content change.                                             |

**Tag extraction:** Tags are `#tagname` tokens found anywhere in `content`. The UI scans the content at render time to find them. Tags are displayed at the bottom of the card. No tags array is stored in the file.

**Title extraction:** The UI uses the first non-empty line of `content` as the card's display title (stripping a leading `#` if present). The full content is shown as-entered in the editor.

**What is NOT in the card file:**
- Column placement → lives in `manifest.json → cards`
- Card order within column → position in the manifest array
- Color → derived from tag weights at render time (tag with highest weight wins)

**Self-heal rule:** When the extension loads a card, if the card file's implicit placement (derived from manifest) disagrees with any stale data, the manifest always wins. The extension may rewrite the card file silently to remove any conflicting fields introduced by manual edits.

---

### 4.3 History File (`cards/{id}-history.json`)

The history file records the full journey of a card across columns. It is a sibling of the card file, sharing the same name prefix.

```json
{
  "card_id": "20260326-b7c2",
  "column_history": [
    {
      "column": "backlog",
      "entered_at": "2026-03-01T10:00:00Z",
      "exited_at":  "2026-03-10T09:30:00Z"
    },
    {
      "column": "in-progress",
      "entered_at": "2026-03-10T09:30:00Z",
      "exited_at":  "2026-03-24T16:00:00Z"
    },
    {
      "column": "review",
      "entered_at": "2026-03-24T16:00:00Z",
      "exited_at":  null
    }
  ]
}
```

**Rules:**
- History files are **optional**. Their absence is never an error.
- History files are **freely deletable** by the user at any time. The board continues functioning normally.
- The array is **append-only**. The extension never modifies existing entries, only appends.
- When a card moves columns, the extension sets `exited_at` on the last entry and appends a new entry for the destination column.
- The current column's entry always has `exited_at: null`.
- History files may be excluded from version control via `.gitignore` (`**/*-history.json`).

**Derived metrics from history:**
- **Cycle time** for a column = `exited_at - entered_at` for that column's entry.
- **Lead time** = timestamp of entering the first non-backlog column → timestamp of entering the final column.

---

### 4.4 Archive

Archiving is a **manual, deliberate action** triggered by the user through the UI. There are no automatic archive rules.

**Archive operation (atomic, performed by extension):**

1. Move `cards/{id}.json` → `archive/{id}.json`
2. Move `cards/{id}-history.json` → `archive/{id}-history.json` (if exists)
3. Remove card ID from the relevant column array in `manifest.json → cards`
4. Append entry to today's log file
5. Fire `card.archived` hook asynchronously

Archived card files are **identical in schema** to live card files. No archive-specific fields are added. The location (`archive/`) is the only indicator that a card is archived.

The `archive/` folder is **read-only from the board's perspective** — the extension never modifies archived files after the move.

---

### 4.5 Log Files (`logs/YYYY-MM-DD.log`)

One log file per calendar day. Created automatically by the extension on the first event of each day. Append-only.

**Log entry format:**
```
[2026-03-26T10:32:00Z] [card.created]   20260326-b7c2 "Implement login flow"
[2026-03-26T11:15:00Z] [card.moved]     20260326-b7c2 backlog → in-progress
[2026-03-26T11:15:00Z] [hook.fired]     scripts/notify.sh (card.moved)
[2026-03-26T14:00:00Z] [wip.violated]   in-progress limit=3 current=4
[2026-03-26T14:05:00Z] [tag.added]      20260326-b7c2 bug
[2026-03-26T16:30:00Z] [card.archived]  20260326-b7c2 "Implement login flow"
```

**Rules:**
- Timestamps are always UTC ISO 8601.
- Every board event produces exactly one log entry.
- Every hook execution attempt produces a `hook.fired` log entry (regardless of script success or failure).
- Hook failures are logged with `[hook.failed]` and include the exit code.
- Log files may be safely deleted by the user. The board does not depend on them.

---

## 5. Kanban Methodologies

### 5.1 WIP Limits

WIP (Work In Progress) limits cap the number of cards allowed in a column simultaneously.

**Configuration:** `wip_limit` field on each column in `manifest.json`. `null` = no limit.

**Enforcement rules:**
- The extension checks the WIP limit **before** completing a card move into a column.
- If moving a card would cause `cards[column].length > wip_limit`, the extension fires a `wip.violated` event and **notifies the user via the UI**.
- The move is **not blocked** — WIP limits are advisory warnings, not hard locks. The user decides whether to proceed.
- The `wip.violated` hook fires **after** the move is completed if the user proceeds.

**WIP violation log entry:**
```
[2026-03-26T14:00:00Z] [wip.violated] in-progress limit=3 current=4
```

---

### 5.2 Cycle Time & Lead Time

Cycle time and lead time are derived automatically from the history file. No manual input is required.

**Definitions:**

| Metric                      | Definition                                                                      |
| --------------------------- | ------------------------------------------------------------------------------- |
| **Cycle time** (per column) | Time a card spent in a specific column. `exited_at - entered_at`.               |
| **Cycle time** (total)      | Time from first active column entry to last column entry.                       |
| **Lead time**               | Time from card creation (`metadata.created_at`) to entry into the final column. |

**Calculation:** The VSCode extension reads `{id}-history.json` and computes these values on demand when a card is opened or a metrics view is shown. If the history file does not exist, metrics are shown as unavailable — no error.

---

## 6. Tag System

Tags are the primary tool for categorisation, prioritisation, and visual communication on the board.

**Tag registry** lives in `manifest.json → tags`. Tags must be defined here before they can be used on cards.

```json
"tags": {
  "blocker": { "color": "#e74c3c", "weight": 1.0 },
  "bug":     { "color": "#e67e22", "weight": 0.8 },
  "feature": { "color": "#3498db", "weight": 0.5 },
  "docs":    { "color": "#95a5a6", "weight": 0.2 }
}
```

**Color resolution rule:** When a card has multiple tags, the tag with the **highest weight** determines the card's display color. This is computed at render time — no color is stored on the card itself.

**Weight scale:** Float `0.0` to `1.0`. Higher weight = higher visual priority. Recommended convention:

| Weight range | Suggested use                                       |
| ------------ | --------------------------------------------------- |
| `0.9 – 1.0`  | Critical / blocking (e.g. `blocker`, `hotfix`)      |
| `0.6 – 0.8`  | High priority (e.g. `bug`, `urgent`)                |
| `0.3 – 0.5`  | Normal work (e.g. `feature`, `improvement`)         |
| `0.0 – 0.2`  | Low priority / informational (e.g. `docs`, `chore`) |

**Using tags as a blocker system:** Create a `blocker` tag with `weight: 1.0` and a red color. When a card is blocked, add the `blocker` tag and describe the reason in the card's description. Remove the tag when unblocked. No automation required.

**Rules:**
- Tag names on cards must reference existing keys in the manifest tag registry. Unknown tags are flagged as warnings by the extension.
- Deleting a tag from the registry does not automatically remove it from cards — the extension warns on load if orphaned tags are found.
- Tag weight ties are broken by the tag's position in the manifest (earlier defined tag wins).

---

## 7. Hook & Script System

Hooks allow user-defined scripts to react to board events. Scripts can be written in any language — shell, Python, Node.js, etc. — as long as they are executable.

### Event Reference

| Event           | When it fires                                          |
| --------------- | ------------------------------------------------------ |
| `card.created`  | A new card is created                                  |
| `card.deleted`  | A card is permanently deleted                          |
| `card.moved`    | A card moves from one column to another                |
| `card.archived` | A card is moved to the archive                         |
| `wip.violated`  | A card move causes a column to exceed its WIP limit    |
| `tag.added`     | A tag is added to a card                               |
| `tag.removed`   | A tag is removed from a card                           |
| `card.due`      | A card's due date is reached (reserved for future use) |

### Hook Configuration

Hooks are configured in `manifest.json → hooks`. Each event maps to an array of script paths (relative to the board root). Multiple scripts can listen to the same event.

```json
"hooks": {
  "card.moved":    ["scripts/notify.sh", "scripts/sync.py"],
  "card.created":  ["scripts/log_card.py"],
  "wip.violated":  ["scripts/wip_alert.sh"]
}
```

### Script Execution

- Scripts are executed **asynchronously** (fire-and-forget). The board never waits for a script to finish.
- Scripts receive the event payload as **JSON via stdin**.
- Scripts are executed with the **board root folder** as the working directory.
- Each script execution is logged in today's log file with `[hook.fired]` or `[hook.failed]`.

### Event Payloads

**`card.moved`**
```json
{
  "event": "card.moved",
  "timestamp": "2026-03-26T11:15:00Z",
  "card_id": "20260326-b7c2",
  "card_title": "Implement login flow",
  "from_column": "backlog",
  "to_column": "in-progress"
}
```

**`card.created`**
```json
{
  "event": "card.created",
  "timestamp": "2026-03-26T10:32:00Z",
  "card_id": "20260326-b7c2",
  "card_title": "Implement login flow",
  "column": "backlog"
}
```

**`card.deleted`**
```json
{
  "event": "card.deleted",
  "timestamp": "2026-03-26T15:00:00Z",
  "card_id": "20260326-b7c2",
  "card_title": "Implement login flow",
  "last_column": "in-progress"
}
```

**`card.archived`**
```json
{
  "event": "card.archived",
  "timestamp": "2026-03-26T16:30:00Z",
  "card_id": "20260326-b7c2",
  "card_title": "Implement login flow",
  "from_column": "done"
}
```

**`wip.violated`**
```json
{
  "event": "wip.violated",
  "timestamp": "2026-03-26T14:00:00Z",
  "column": "in-progress",
  "wip_limit": 3,
  "current_count": 4,
  "card_id": "20260326-b7c2"
}
```

**`tag.added` / `tag.removed`**
```json
{
  "event": "tag.added",
  "timestamp": "2026-03-26T14:05:00Z",
  "card_id": "20260326-b7c2",
  "card_title": "Implement login flow",
  "tag": "bug"
}
```

---

## 8. Extension Behaviour Rules

These rules govern how the VSCode extension reads and writes the board. Any future UI implementation must follow the same rules.

### Reading

1. On board open, read `manifest.json` first. If invalid or missing, show an error and stop.
2. For each card ID in `manifest.json → cards`, load the corresponding `cards/{id}.json`.
3. If a card file is missing but its ID is in the manifest, show a warning in the UI. Do not crash.
4. If a card file exists in `cards/` but is not referenced in the manifest, treat it as an orphan. Log a warning. Do not display it on the board.
5. Load `{id}-history.json` for each card only when needed (card detail view, metrics). Never load all history files on board open.

### Writing

1. All write operations are atomic where possible: write to a temp file, then rename.
2. Every write to a card file must update `metadata.updated_at`.
3. `metadata.created_at` is written once at creation and never overwritten.
4. After any card move, the manifest is updated first, then the history file is updated.

### Self-Healing

If the extension detects that a card file contains fields that should only live in the manifest (e.g. a `column` field left by manual editing), it removes those fields silently on the next write and logs a `[self-heal]` entry to the log.

### Card ID Generation

```
YYYYMMDD-xxxx
```
- `YYYYMMDD` = UTC date at creation time
- `xxxx` = 4 random lowercase hex characters
- Generated by the extension. Guaranteed unique within a board for practical purposes.
- Example: `20260326-b7c2`

### Orphan Detection

On board load, the extension performs a consistency check:
- **Orphan card files:** Present in `cards/` but not in manifest → warn, do not display.
- **Ghost manifest entries:** In manifest but no corresponding file in `cards/` → warn, display as broken card.
- **Unknown tags on cards:** Tag name not in manifest registry → warn on card detail open.

---

## 9. VSCode Extension

### Core Views

| View             | Description                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Board view**   | Main Kanban board. Columns rendered left-to-right. Cards rendered top-to-bottom within columns. Drag-and-drop to move cards.                                                                                      |
| **Card detail**  | Opens on card click. Single markdown editor for all content. Metadata (`created_at`, `updated_at`, column) shown at top with a collapse/expand toggle. Tags extracted from content displayed at the bottom of the card. Rendered markdown shown as-entered. |
| **Archive view** | Read-only list of archived cards. Searchable. Cards are not interactive — archive is final.                                                                                                                       |
| **Log viewer**   | Read-only view of daily log files. Browse by date.                                                                                                                                                                |
| **Metrics view** | Per-card and per-column cycle time. Board-level throughput. Only shown if history files exist.                                                                                                                    |

### Extension Commands (Command Palette)

| Command                | Action                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `Kanban: Open Board`   | Open the board view for the current workspace                                            |
| `Kanban: New Card`     | Open a new card editor (single markdown box). User picks a column; no separate title prompt. |
| `Kanban: Archive Card` | Archive the currently selected card                                                      |
| `Kanban: Delete Card`  | Permanently delete a card (with confirmation)                                            |
| `Kanban: Add Column`   | Add a new column to the board                                                            |
| `Kanban: Edit Tags`    | Open tag registry editor                                                                 |
| `Kanban: Open Log`     | Open today's log file                                                                    |

### Drag and Drop

- Dragging a card to a new column updates the manifest (removes from source array, inserts at target position).
- Dragging a card within a column reorders the array in the manifest.
- WIP limit check occurs before the drop is finalised. If violated, the user is warned and can cancel or proceed.

### Manifest Watch

The extension watches `manifest.json` for external changes (e.g. git pull, manual edit) and refreshes the board view automatically. Card files are watched individually only when their detail view is open.

---

## 10. Development Tasks

The following tasks cover the full implementation. Each task maps to a specific deliverable.

---

### Phase 1 — Core Schema & Tooling

| ID   | Task                         | Description                                                                                                                                                         |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-01 | JSON schema for manifest     | Write a JSON Schema file (`manifest.schema.json`) that validates the full manifest structure including columns, tags, cards, and hooks.                             |
| T-02 | JSON schema for card file    | Write a JSON Schema file (`card.schema.json`) that validates the card file structure.                                                                               |
| T-03 | JSON schema for history file | Write a JSON Schema file (`history.schema.json`) that validates the history file structure.                                                                         |
| T-04 | Schema versioning strategy   | Document how version integers map to schema changes. Define migration path for version upgrades.                                                                    |
| T-05 | Board initialisation CLI     | A script or extension command that scaffolds a new `kanban/` folder with a valid empty `manifest.json` and empty `cards/`, `archive/`, `logs/`, `scripts/` folders. |

---

### Phase 2 — VSCode Extension Foundation

| ID   | Task                         | Description                                                                                                              |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| T-06 | Extension scaffold           | Initialise a VSCode extension project (TypeScript). Set up build pipeline, linting, and test runner.                     |
| T-07 | Manifest reader              | Module that reads and parses `manifest.json`. Returns typed data structures. Validates against schema on load.           |
| T-08 | Card reader                  | Module that reads individual card files by ID. Returns typed card object. Validates against schema.                      |
| T-09 | Manifest writer              | Module that writes `manifest.json` atomically (write to temp, rename).                                                   |
| T-10 | Card writer                  | Module that writes card files atomically. Always updates `metadata.updated_at` on write.                                 |
| T-11 | Orphan & consistency checker | On board load, run consistency checks. Report orphan card files, ghost manifest entries, and unknown tags. Log warnings. |
| T-12 | Self-heal module             | Detect and remove stale fields from card files that should only live in manifest. Log `[self-heal]` entries.             |
| T-13 | Manifest file watcher        | Watch `manifest.json` for external changes. Emit internal event to trigger board refresh.                                |

---

### Phase 3 — Board UI

| ID   | Task                          | Description                                                                                                                              |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| T-14 | Board view — column rendering | Render columns left-to-right from manifest array. Show column label and WIP limit badge.                                                 |
| T-15 | Board view — card rendering   | Render cards in column order. Show title and tags. Compute and apply card color from tag weights.                                        |
| T-16 | Board view — drag and drop    | Implement card drag-and-drop between columns and within columns. Update manifest on drop.                                                |
| T-17 | WIP limit enforcement         | On card drop, check WIP limit. If violated, show warning UI. Allow user to cancel or proceed. Fire `wip.violated` hook if user proceeds. |
| T-18 | Card detail view              | Open on card click. Single markdown editor for the full `content` field. Metadata panel (collapsed by default) at top shows `created_at`, `updated_at`, and current column. Tags extracted from `#tag` tokens in content and displayed as chips at the bottom. |
| T-19 | New card creation             | Command opens a blank single-box markdown editor. User selects target column (dropdown). On save: generate ID, write card file with `content`, add to manifest. |
| T-20 | Card deletion                 | Command with confirmation dialog. Remove from manifest, delete card file and history file. Fire `card.deleted` hook.                     |
| T-21 | Card archiving                | Command to archive selected card. Execute archive operation (move files, update manifest). Fire `card.archived` hook.                    |
| T-22 | Archive view                  | Read-only list of cards in `archive/` folder. Searchable by title and tags.                                                              |
| T-23 | Tag editor                    | UI to add, edit, and delete tags in the manifest tag registry. Show color picker and weight slider. Tags on cards are authored inline as `#tagname` in the markdown content — no per-card tag picker needed. |
| T-24 | Column manager                | UI to add, rename, reorder, and delete columns. Prevent deletion of columns that still contain cards.                                    |

---

### Phase 4 — Kanban Methodologies

| ID   | Task                       | Description                                                                                                                                                      |
| ---- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-25 | WIP limit configuration UI | Allow setting and clearing `wip_limit` per column from the column header.                                                                                        |
| T-26 | History file writer        | On every card move, append to `{id}-history.json`. Set `exited_at` on previous entry, create new entry for destination column. Create file if it does not exist. |
| T-27 | Cycle time calculation     | Read history file and compute time spent in each column. Display per-column cycle time in card detail view.                                                      |
| T-28 | Lead time calculation      | Compute lead time from `metadata.created_at` to entry into the last column in history. Display in card detail view.                                              |
| T-29 | Metrics view               | Board-level view showing average cycle time per column across all cards with history files.                                                                      |

---

### Phase 5 — Hook System

| ID   | Task                   | Description                                                                                                                                            |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T-30 | Hook dispatcher        | Module that reads hook configuration from manifest and executes the relevant scripts for a given event. Runs scripts asynchronously (fire-and-forget). |
| T-31 | Payload builder        | For each event type, build the correct JSON payload object and pipe it to the script via stdin.                                                        |
| T-32 | Hook execution logging | Log `[hook.fired]` and `[hook.failed]` entries to the daily log file for every hook execution attempt. Include script path and exit code on failure.   |
| T-33 | Hook configuration UI  | UI to add and remove scripts from each hook event in the manifest.                                                                                     |

---

### Phase 6 — Logging

| ID   | Task              | Description                                                                                                                                           |
| ---- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-34 | Log writer module | Module that appends formatted entries to the correct daily log file. Creates the file and `logs/` folder if they do not exist. All timestamps in UTC. |
| T-35 | Log viewer        | VSCode view to browse and read daily log files. Navigate by date. Read-only.                                                                          |

---

### Phase 7 — Polish & Edge Cases

| ID   | Task                         | Description                                                                                                                         |
| ---- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| T-36 | Unknown tag warning          | When loading a card whose tags include names not in the manifest registry, show a warning badge on the card and in the detail view. |
| T-37 | Missing card file handling   | When manifest references a card ID with no corresponding file, show a broken card placeholder in the UI. Do not crash.              |
| T-38 | Orphan card file handling    | Detect card files in `cards/` not referenced in manifest. Show in a dedicated "Orphans" section or warning panel.                   |
| T-39 | Atomic write safety          | Ensure all manifest and card writes go through temp-file-then-rename to prevent corruption on crash.                                |
| T-40 | Board initialisation command | `Kanban: Initialise Board` command that creates the full folder structure and a valid empty manifest in the current workspace.      |
| T-41 | `.gitignore` helper          | On board initialisation, offer to append `**/*-history.json` and `logs/` to `.gitignore`.                                           |
| T-42 | Extension settings           | VSCode settings for: default WIP limits, default columns for new boards, log retention warning threshold.                           |

---

## Appendix A — Complete Example

### `manifest.json`
```json
{
  "version": 1,
  "name": "my-project",
  "columns": [
    { "id": "backlog",      "label": "Backlog",      "wip_limit": null },
    { "id": "in-progress",  "label": "In Progress",  "wip_limit": 3    },
    { "id": "review",       "label": "Review",       "wip_limit": 2    },
    { "id": "done",         "label": "Done",         "wip_limit": null }
  ],
  "tags": {
    "blocker": { "color": "#e74c3c", "weight": 1.0 },
    "bug":     { "color": "#e67e22", "weight": 0.8 },
    "feature": { "color": "#3498db", "weight": 0.5 },
    "docs":    { "color": "#95a5a6", "weight": 0.2 }
  },
  "cards": {
    "backlog":     ["20260320-a1b2"],
    "in-progress": ["20260326-b7c2"],
    "review":      [],
    "done":        []
  },
  "hooks": {
    "card.moved":    ["scripts/notify.sh"],
    "card.created":  [],
    "card.deleted":  [],
    "card.archived": [],
    "wip.violated":  ["scripts/wip_alert.sh"],
    "tag.added":     [],
    "tag.removed":   [],
    "card.due":      []
  }
}
```

### `cards/20260326-b7c2.json`
```json
{
  "id": "20260326-b7c2",
  "title": "Implement login flow",
  "description": "## Overview\n\nImplement JWT-based login.\n\n- POST /auth/login\n- Store token in httpOnly cookie",
  "tags": ["feature"],
  "metadata": {
    "created_at": "2026-03-26T10:00:00Z",
    "updated_at": "2026-03-26T14:32:00Z"
  }
}
```

### `cards/20260326-b7c2-history.json`
```json
{
  "card_id": "20260326-b7c2",
  "column_history": [
    {
      "column": "backlog",
      "entered_at": "2026-03-26T10:00:00Z",
      "exited_at":  "2026-03-26T14:30:00Z"
    },
    {
      "column": "in-progress",
      "entered_at": "2026-03-26T14:30:00Z",
      "exited_at":  null
    }
  ]
}
```

### `logs/2026-03-26.log`
```
[2026-03-26T10:00:00Z] [card.created]  20260326-b7c2 "Implement login flow"
[2026-03-26T14:30:00Z] [card.moved]    20260326-b7c2 backlog → in-progress
[2026-03-26T14:30:00Z] [hook.fired]    scripts/notify.sh (card.moved)
```

---

## Appendix B — Decisions Log

| Decision                                      | Rationale                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| JSON only, no YAML                            | Single format, simpler tooling, no ambiguity.                                                   |
| Manifest as source of truth for placement     | Single authoritative source. Prevents split-brain between card file and manifest.               |
| Card content in separate files                | Git-friendly. One card changed = one file changed in git diff.                                  |
| History files optional and deletable          | Privacy, disk space, git cleanliness. Board never depends on them.                              |
| History file as sibling (`{id}-history.json`) | Co-located with card. Move together naturally. No separate folder to manage.                    |
| No swimlanes                                  | Unnecessary complexity for solo dev. Tags handle categorisation.                                |
| No blockers field                             | Tags handle blocker signalling. Description holds the reason. Less automation, less complexity. |
| No archive.json                               | Archive folder mirrors cards folder. No second schema to maintain.                              |
| Archive is manual only                        | Archiving is a deliberate act. No automated cleanup.                                            |
| Hooks are async (fire-and-forget)             | Board never waits on scripts. Script failures don't affect board state.                         |
| WIP limits are advisory, not hard blocks      | Developer autonomy. Warnings inform, they don't obstruct.                                       |
| Tag weight float 0.0–1.0                      | Granular priority. Highest weight wins card color. Natural severity scale.                      |
| Logs split by day                             | Easy to find, easy to delete old logs, clean git history if logs are committed.                 |
| No AI features built in                       | Manifest is AI-readable by design. AI interaction happens externally.                           |
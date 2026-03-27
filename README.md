# Personal Kanban

A file-based personal kanban board for VSCode. The entire board state lives in plain JSON files inside your project — no database, no server, no account required.

## Features

- **Git-friendly** — one card changed = one file changed; commit your board alongside your code
- **File-based** — board state is human-readable JSON you can edit directly in a pinch
- **AI-readable** — structured so an AI can understand board state without special tooling
- **Drag and drop** — move cards between columns and reorder within a column
- **Inline editing** — double-click any card to edit (markdown supported)
- **Tag system** — write `#tagname` anywhere in a card and tags appear automatically
- **Live sync** — editing `manifest.json` externally refreshes the board instantly

## Commands

| Command | Description |
|---|---|
| `Kanban: Init Board` | Creates `.personal-kanban/` in the workspace root with a default `manifest.json` and `cards/` folder |
| `Kanban: Open Board` | Opens the Kanban board webview panel |

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type `Kanban` to find both commands.

## Board Structure

Running `Kanban: Init Board` creates:

```
{workspace-root}/
└── .personal-kanban/
    ├── manifest.json   ← source of truth for column order and card placement
    └── cards/
        └── {id}.json   ← one file per card
```

The default columns are **Backlog**, **In Progress**, **Review**, and **Done**. To change column names or add columns, edit `manifest.json` directly.

### Card IDs

Cards are identified by `YYYYMMDD-xxxx` (UTC date + 4 random hex chars), e.g. `20260326-b7c2`.

## Usage

1. Open a project folder in VSCode.
2. Run `Kanban: Init Board` — this creates the `.personal-kanban/` folder.
3. Run `Kanban: Open Board` to view the board.
4. Click **+ Add card** at the bottom of any column to create a card.
5. **Single-click** a card to read it. **Double-click** to edit.
6. Press `Ctrl+S` or click away to save. Press `Escape` to discard changes.
7. Drag cards between columns or reorder within a column.
8. Hover a card and click the delete button to remove it (confirmation required).

### Tags

Add `#tagname` anywhere in a card's content. Tags are extracted at render time and displayed on the card face. No configuration needed.

### Editing the board manually

The `manifest.json` is the source of truth. You can edit it directly — the board refreshes automatically when the file changes. If `manifest.json` and a card file disagree on column placement, `manifest.json` wins.

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
3. In that new window, open any folder, then run the `Kanban:` commands.

### Packaging and installing the VSIX

Install the VSCode Extension CLI if you don't have it:

```bash
npm install -g @vscode/vsce
```

Package the extension:

```bash
vsce package
# produces personal-kanban-0.0.1.vsix
```

Install the `.vsix` file:

```bash
code --install-extension personal-kanban-0.0.1.vsix
```

Or in VSCode: open the Extensions sidebar → `...` menu → **Install from VSIX...** → select the file.

## Source layout

```
src/
├── extension.ts   — activation, command registration
├── BoardPanel.ts  — webview panel (HTML, CSS, JS, message handling)
├── io.ts          — file I/O: manifest reader/writer, card reader/writer, file watcher
└── types.ts       — TypeScript interfaces for manifest and card shapes
```

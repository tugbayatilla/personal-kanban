---
name: personal-kanban
description: Manage tasks using the personal-kanban VSCode extension board. Use when the user wants to see tasks, start work on a card, move cards between columns, or create new cards. This skill is always active for this project — every piece of work must have a card.
---

# Personal Kanban Board Manager

**Board root:** `.personal-kanban/` (relative to workspace root)
**Manifest:** `.personal-kanban/manifest.json`
**Cards:** `.personal-kanban/cards/{id}.json`

## Reading the Board

Always start by reading the manifest, then load relevant card files.

### Step 1 — Read manifest
```
Read: .personal-kanban/manifest.json
```
The manifest contains:
- `columns[]` — ordered list of `{ id, label, wip_limit }` objects
- `cards` — object mapping `column_id → [card_id, ...]`

### Step 2 — Read cards
For each card ID in a column, read its file:
```
Read: .personal-kanban/cards/{id}.json
```
Card file structure:
```json
{
  "id": "20260327-e2b7",
  "content": "#improvement\n\n# Card Title\n\nDescription text...",
  "metadata": {
    "created_at": "2026-03-27T12:54:11.681Z",
    "updated_at": "2026-03-27T13:08:43.844Z",
    "branch": "improvement/card-title"
  }
}
```

`metadata.branch` is optional — it is set when a card enters In Progress and cleared after merge on Done.

### Parsing card content
Card `content` is free-form markdown:
- Lines starting with `#tagname` (no space after `#`) are **tags**
- The first `# Title` line (space after `#`) is the **card title**
- Remaining lines are the **description**

Example:
```
#feature

# Add dark mode

Support a dark colour scheme in the webview panel.
```
→ tag: `feature`, title: `Add dark mode`

---

## Columns (default order)

| Column ID    | Label       | Notes                  |
|---|---|---|
| `backlog`    | Backlog     | Unrefined items        |
| `refined`    | Refined     | Ready to work          |
| `in-progress`| In Progress | Active work (WIP: 1)   |
| `review`     | Review      | Awaiting human review  |
| `done`       | Done        | Fully complete         |

> Always read the actual manifest — columns and their order may differ.

---

## Core Rule: Every Task Needs a Card

This skill is **always active**. Before starting any work:
1. Read the manifest and load cards.
2. Find or create a card for the current work.
3. Ensure it is in **In Progress** while work is happening.

---

## Full Implementation Workflow

### 1. Move card to In Progress

Update the manifest's `cards` object:
- Remove card ID from its current column array.
- Append card ID to `in-progress` array.
- Write updated manifest back to `.personal-kanban/manifest.json`.
- Update `metadata.updated_at` on the card file.

### 2. Create a branch

Name format: `{prefix}/{short-descriptive-name}`

| Card tag      | Branch prefix  |
|---|---|
| `#feature`    | `feature/`     |
| `#bug`        | `bug/`         |
| `#improvement`| `improvement/` |
| `#chore`      | `chore/`       |

```bash
git checkout main
git pull origin main
git checkout -b feature/short-name
```

After creating the branch, **save it to the card's metadata**:
- Set `metadata.branch` to the branch name (e.g. `"feature/short-name"`).
- Update `metadata.updated_at`.
- Write the updated card file.

### 3. Baseline — run tests and get green
```bash
npm test
```
If tests are already failing, fix them first and commit: `fix: restore green test baseline`

### 4. Implement the solution
- Make **small, focused commits** as you go.
- Commit message format: `type: short description` (Conventional Commits).

### 5. Implement tests
Write tests for the new behaviour. All must pass.

### 6. Push the branch and move to Review automatically

When implementation is complete, **do not ask — execute immediately**:

```bash
git push -u origin {branch-name}
```

Then update the manifest:
- Remove card ID from `in-progress`.
- Append card ID to `review`.
- Write updated manifest.

Update the card file:
- Append ` #claude-code` to the tag line in `content`.
- Add a summary line and date after the title.
- Update `metadata.updated_at`.
- Keep `metadata.branch` — it is still needed for the merge step.

**Stop here.** Wait for the human to review and drag the card to Done.

---

### 8. Done — merge into main (triggered when card moves to Done)

When the user signals that a card is done (via `/personal-kanban done` or by dragging it to the Done column), perform the merge for that card.

1. Read the card file and retrieve `metadata.branch`.
2. Merge and push:
   ```bash
   git checkout main
   git pull origin main
   git merge --no-ff {branch-name} -m "Merge {branch-name} into main"
   git push origin main
   ```
3. Clean up the branch:
   ```bash
   git branch -d {branch-name}
   git push origin --delete {branch-name}
   ```
4. Update the card file:
   - Remove (or null out) `metadata.branch`.
   - Update `metadata.updated_at`.
   - Write the updated card file.
5. Update the manifest:
   - Remove card ID from `review`.
   - Append card ID to `done`.
   - Write updated manifest.

> If multiple cards are in Review, the user must specify which one to mark Done. Read all Review card files to show titles and their branch names before acting.

---

## Card Operations

### Moving a card between columns

1. Read manifest.
2. Find the card ID in its current column array and remove it.
3. Append the card ID to the target column array.
4. Write updated manifest (atomic: write to `.personal-kanban/manifest.json.tmp`, then rename).
5. Update `metadata.updated_at` on the card file.

### Creating a new card

Generate an ID with format `YYYYMMDD-xxxx` (UTC date + 4 random hex chars, e.g. `20260327-a3f1`).

Card content template:
```
#<tag>

# <Title>

<Description>
```

Steps:
1. Write the new card file to `.personal-kanban/cards/{id}.json` with `created_at` and `updated_at` set to current UTC time. Do not set `branch` yet.
2. Read manifest.
3. Append the new card ID to the target column array (default: `in-progress`).
4. Write updated manifest.

---

## Session Start (automatic)

When invoked:
1. Read `.personal-kanban/manifest.json`.
2. Read all card files referenced in the manifest.
3. Check **in-progress** — if a card matches the current task, continue from there.
4. If no match in in-progress → pick the **top card from `refined`** (or `backlog` if refined is empty) → move to `in-progress`.
5. **If no card exists** → create one in `in-progress` before starting work.

---

## Commands

- `/personal-kanban` — show board status: all columns, card counts, and card titles
- `/personal-kanban start` — pick top card from refined/backlog → move to in-progress
- `/personal-kanban review` — push branch, move active in-progress card to review, append `#claude-code` (also happens automatically at end of implementation)
- `/personal-kanban done [card-title]` — merge the branch from the card's metadata, move card to done
- `/personal-kanban list` — list all cards grouped by column with tag, title, and branch (if set)
- `/personal-kanban new #tag Title` — create a new card directly in in-progress
- `/personal-kanban raise #tag Title` — create a new card from a review finding, pull to in-progress (see below)

---

## Review Issues — Never Pull a Card Back

**Rule:** A card in Review stays in Review. If a review surfaces a bug or improvement, **never move the Review card back to In Progress**.

**Instead — use `/personal-kanban raise`:**

1. Create a new card with the appropriate tag in `in-progress`.
2. Leave the Review card exactly where it is (branch preserved in its metadata).
3. Work the new card through the full implementation workflow.

### `/personal-kanban raise #tag Title` — steps

1. Read manifest and cards.
2. Create a new card in `in-progress`:
   ```
   #<tag>

   # <Title>

   Raised from review of: <original card title>
   ```
3. Create a branch: `{tag}/short-name`. Save branch to new card's `metadata.branch`.
4. Report what was created and which Review card it was raised from.

---

## Execution Steps

When invoked:
1. Read `.personal-kanban/manifest.json`
2. Read all card files listed in the manifest
3. Report a summary (column label + card count + card titles + branch if set)
4. Execute the requested action
5. Confirm all changes made to manifest and card files

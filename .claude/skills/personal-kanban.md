---
name: personal-kanban
description: Manage tasks using the personal-kanban VSCode extension board. Use when the user wants to see tasks, start work on a card, move cards between columns, or create new cards. This skill is always active for this project — every piece of work must have a card.
---

# Personal Kanban Board Manager

**Board root:** `.personal-kanban/` (relative to workspace root)
**Manifest:** `.personal-kanban/manifest.json`
**Cards:** `.personal-kanban/cards/{id}.json`

## Reading the Board

Always start by reading the manifest, then load **only the cards you need** — never read all cards upfront.

### Step 1 — Read manifest
```
Read: .personal-kanban/manifest.json
```
The manifest contains:
- `columns[]` — ordered list of `{ id, label, wip_limit, cards }` objects. Each column owns its card IDs directly.

### Step 2 — Read cards (active columns only)

**Default:** Read card files only for `in-progress` and `refined` columns. Do **not** read backlog or done cards unless the user explicitly asks about them.

When you need a card's title for a specific card ID (e.g. for `/personal-kanban list`), read only that card file:
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

`metadata.branch` is optional — it is set when a card enters In Progress. It is **never cleared** — it persists on the card even after merging to Done, as a permanent record of which branch was used.

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

Update the manifest's `columns` array:
- Find the column object containing the card ID, remove it from that column's `cards` array.
- Find the `in-progress` column object, append the card ID to its `cards` array.
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

### 6. Commit, push, and move to Review

When implementation is complete, **do not ask — execute immediately**:

**a. Commit all uncommitted changes**
```bash
git add -A
git commit -m "type: short description"
```
If there is nothing to commit (all changes already committed), skip this step.

**b. Push the branch**
```bash
git push -u origin {branch-name}
```

**c. Move card to Review**

Update the manifest:
- Find the `in-progress` column object, remove the card ID from its `cards` array.
- Find the `review` column object, append the card ID to its `cards` array.
- Write updated manifest.

Update the card file:
- Append ` #claude-code` to the tag line in `content`.
- Add a summary line and date after the title.
- Update `metadata.updated_at`.
- Keep `metadata.branch` — it is still needed for the merge step.

**Stop here.** Wait for the human to review and drag the card to Done.

---

### 7. Done — merge into main (triggered when card moves to Done)

When the user signals that a card is done (via `/personal-kanban done` or by dragging it to the Done column), perform the merge for that card.

1. Read the card file and retrieve `metadata.branch`.
2. Check whether the branch still exists before merging:
   ```bash
   git show-ref --verify --quiet refs/heads/{branch-name} \
     || git show-ref --verify --quiet refs/remotes/origin/{branch-name}
   ```
   - If the branch **does not exist** (command exits non-zero), skip steps 3–4 entirely and proceed directly to step 5. Log a note: "Branch {branch-name} not found — skipping merge."
   - If the branch **exists**, continue with the merge.
3. Merge and push:
   ```bash
   git checkout main
   git pull origin main
   git merge --no-ff {branch-name} -m "Merge {branch-name} into main"
   git push origin main
   ```
4. Clean up the branch:
   ```bash
   git branch -d {branch-name}
   git push origin --delete {branch-name}
   ```
5. Update the card file:
   - **Do not remove `metadata.branch`** — it is kept as a permanent record.
   - Update `metadata.updated_at`.
   - Write the updated card file.
6. Update the manifest:
   - Find the `review` column object, remove card ID from its `cards` array.
   - Find the `done` column object, append card ID to its `cards` array.
   - Write updated manifest.

> If multiple cards are in Review, the user must specify which one to mark Done. Read all Review card files to show titles and their branch names before acting.

---

## Card Logs

Every card has its own append-only log file at `.personal-kanban/logs/cards/{id}.log`. The extension writes a timestamped entry automatically for:

- `created in column: {column}` — when the card is first created
- `updated` — when card content is saved
- `moved from {from} to {to}` — on every column move
- `branch merged into main: {branch}` — after a successful git merge
- `deleted from column: {column}` — when the card is deleted

These files are written by the extension. Claude does not need to write them manually.

---

## Card Operations

### Moving a card between columns

1. Read manifest.
2. Find the column containing the card ID, remove it from that column's `cards` array.
3. Append the card ID to the target column's `cards` array.
4. Write updated manifest.
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
3. Append the new card ID to the target column's `cards` array (default: `in-progress`).
4. Write updated manifest.

---

## Session Start (automatic)

When invoked:
1. Run `node .personal-kanban/scripts/next-card.js` to get the next card without reading the full manifest. The script checks `in-progress[0]` → `refined[0]` → `backlog[0]` and outputs only that card's JSON.
2. If the card is already in `in-progress`, continue from there.
3. If the card is in `refined` or `backlog`, move it to `in-progress` (read manifest only for this update).
4. **If no card exists** → create one in `in-progress` before starting work.

---

## Commands

- `/personal-kanban` — show board status: all columns with card counts; show titles only for in-progress and refined (not backlog/done)
- `/personal-kanban start` — pick top card from refined/backlog → move to in-progress
- `/personal-kanban review` — commit uncommitted work, push branch, move active in-progress card to review, append `#claude-code` (also happens automatically at end of implementation)
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
2. Read card files for relevant columns only (in-progress and refined; backlog only if needed)
3. Report a summary (column label + card count + card titles + branch if set)
4. Execute the requested action
5. Confirm all changes made to manifest and card files

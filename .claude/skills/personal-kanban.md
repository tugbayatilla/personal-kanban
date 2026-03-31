---
name: personal-kanban
description: Manage tasks using the personal-kanban VSCode extension board. Use when the user wants to see tasks, start work on a card, move cards between columns, or create new cards. This skill is always active for this project — every piece of work must have a card.
---

# Personal Kanban Board Manager

**Root:** `.personal-kanban/` | **Manifest:** `.personal-kanban/manifest.json` | **Cards:** `.personal-kanban/cards/{id}.md`

## Core Rule — Every Task Needs a Card
Before starting any work, find or create a card and ensure it is In Progress.

## Columns
`backlog` → `refined` → `in-progress` → `review` → `done`  (read manifest for actual order and IDs)

## Reading the Board
- Run `node .personal-kanban/scripts/next-card.js`; fall back to reading the manifest only if the script fails.
- Read card files only for in-progress and refined; skip backlog and done unless explicitly asked.
- Card format: frontmatter (id, created_at, updated_at), then markdown with `#tag` lines and `# Title` heading.

## Implementation Workflow
- Move card to in-progress: remove id from current column, append to in-progress, update card's updated_at.
- Create branch `{tag-prefix}/short-name` from a fresh pull of main; save branch name to card metadata.
- Run tests to confirm green baseline before changing anything.
- Make small focused commits with Conventional Commits messages throughout.
- Write tests for new behaviour; all must pass before proceeding.
- Commit remaining work, push branch, move card to review, append `#claude-code` to card tag line. Stop.

## Done (triggered by user)
- Retrieve branch from card metadata; skip merge if branch no longer exists.
- Merge with `--no-ff` into main, push, delete branch locally and remotely.
- Move card to done in manifest; keep `metadata.branch` as a permanent record.

## Card Operations
- Create: generate `YYYYMMDD-xxxx` id, write card file, append id to target column in manifest.
- Move: remove id from source column, append to target, update card's updated_at.

## Commands
- `/personal-kanban` — board status: column counts + in-progress and refined card titles.
- `/personal-kanban start` — move top refined/backlog card to in-progress.
- `/personal-kanban review` — commit, push, move active in-progress card to review.
- `/personal-kanban done [title]` — merge branch, move card to done.
- `/personal-kanban list` — all cards grouped by column with tag, title, branch.
- `/personal-kanban new #tag Title` — create card in in-progress.
- `/personal-kanban raise #tag Title` — create card from a review finding; never pull review card back to in-progress.

---
name: code-mvp
description: Implement a task from an mvpN.md file through the full development lifecycle — branch, develop, commit, merge. Use when the user wants to start or continue work on an MVP task. Accepts an optional MVP number (e.g. `/code-mvp 2` or `/code-mvp 2 M2-03`). Defaults to the highest-numbered mvpN.md that has incomplete tasks. Always marks tasks complete on finish.
---

# Code MVP — Development Lifecycle

**Task source:** `mvpN.md` (N = MVP number, detected automatically or specified by the user)
**Plan reference:** `plan.md`

This skill manages the full lifecycle of implementing a single task from the MVP: picking the task, creating a branch, implementing with small commits, and merging back to main.

---

## Full Implementation Workflow

### 0. Determine the MVP file

1. Check the invocation for an explicit MVP number (e.g. `/code-mvp 2` → `mvp2.md`).
2. If none given, glob for all `mvpN.md` files in the project root, sort by N ascending, and pick the **lowest-numbered file that still has incomplete tasks**.
3. If all tasks in all MVP files are complete, report that and stop.

Report which file is being used before proceeding.

---

### 1. Pick a task

Read the selected `mvpN.md`. Find the first task row that is **not yet marked complete**.

> A task is complete when its row contains a checkmark or `~~strikethrough~~`. Unmarked rows are available.

If the user specified a task ID (e.g. `M2-03`), use that one instead.

Report the selected task: **MVP file**, **ID**, **name**, and **description**.

---

### 2. Create a branch

Name format: `{prefix}/{short-descriptive-name}`

| Task group | Branch prefix |
|---|---|
| Scaffold / Setup | `feature/` |
| File I/O | `feature/` |
| Webview / UI | `feature/` |
| Tags / Filtering | `feature/` |
| Edge Cases / Hardening | `fix/` |
| Bug fix | `bug/` |
| Improvement | `improvement/` |
| Chore | `chore/` |

```bash
git checkout main
git pull origin main
git checkout -b feature/short-name
```

---

### 3. Implement the solution

- Make **small, focused commits** as you go.
- Commit message format: `type: short description` (Conventional Commits).
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

---

### 4. Run tests (if applicable)

```bash
# Run the project test suite if one exists
npm test  # or equivalent
```

All tests must pass before merging.

---

### 5. Merge into main

```bash
git checkout main
git pull origin main
git merge --no-ff {branch-name} -m "Merge {branch-name} into main"
git push origin main
```

### 5a. Clean up branch

```bash
git branch -d {branch-name}
git push origin --delete {branch-name}
```

---

### 6. Mark task complete in mvpN.md

After a successful merge, update the task row in the MVP file used.

Change the task ID cell to include a checkmark:

**Before:**
```
| M2-03 | Some task | ... |
```

**After:**
```
| ~~M2-03~~ ✓ | ~~Some task~~ | ... |
```

---

### 7. Update plan.md (if relevant)

If the task changes a decision, adds a new component, or resolves a documented concern in `plan.md`, update the relevant section.

---

## Commands

- `/code-mvp` — auto-detect MVP file; pick the next uncompleted task
- `/code-mvp 2` — use `mvp2.md`; pick the next uncompleted task
- `/code-mvp 2 M2-03` — use `mvp2.md` and start with task M2-03
- `/code-mvp status` — show all mvpN.md files, their task counts, and completion status

---

## Session Start (automatic)

When invoked:
1. Determine the MVP file (step 0).
2. Read it — find the first incomplete task (or the one specified).
3. Check `git status` — if already on a feature branch, continue from there.
4. Report the MVP file, task, and branch, then begin implementation.

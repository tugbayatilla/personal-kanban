# Kanban Board Guidelines

## Columns

| Column | Purpose |
|--------|---------|
| Backlog | All ideas and future work. No commitment yet. |
| Refined | Scoped, estimated, and ready to be picked up. |
| In Progress | Actively being worked on. Respect WIP limits. |
| Review | Work complete, awaiting review or verification. |
| Done | Accepted and shipped. |

## Rules

1. **One thing at a time.** Keep In Progress cards to a minimum. Set a WIP limit if needed.
2. **Refine before starting.** A card should be in Refined with a clear description before moving to In Progress.
3. **Move cards forward, not backward.** If a card needs rework, add a note rather than pulling it back.
4. **Archive regularly.** Move Done cards to the archive to keep the board clean.

## Tags

- `bug` — Something broken that needs fixing.
- `feature` — New functionality.
- `chore` — Maintenance, dependency updates, tooling.
- `urgent` — Needs attention before other work.

## Scripts & Hooks

- `scripts/card-reviewed.js` — Sends a system notification when a card moves to Review.
- `scripts/wip-alert.js` — Sends a system notification when a WIP limit is exceeded.

Customize or add scripts in `.vscode/settings.json` under `personal-kanban.scripts` and `personal-kanban.hooks`.

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

## Coding

### Implementation Workflow

1. Move card to in-progress: remove id from current column, append to in-progress; `active_at` is stamped automatically.
2. Create branch `{tag-prefix}/short-name` from a fresh pull of main; save branch name to card metadata.
3. Run the tests and make sure all green.
4. Append a `## Plan` section to the card content describing the implementation approach.
5. Run tests to confirm green baseline before changing anything.
6. Implement the solution following the plan.
7. Make small focused commits with Conventional Commits messages throughout.
8. Write tests for new behaviour; all must pass before proceeding.
9. Append a `## Summary` section to the card content describing what was done.
10. Update relevant documentation (README, changelogs, inline docs) to reflect the changes.
11. Commit remaining work, push branch, move card to review, append `#claude-code` to card tag line. Stop.

### Card Format

Card files live in `cards/<id>.md` and use YAML frontmatter followed by Markdown body:

```
---
id: <YYYYMMDD-xxxx>
created_at: <ISO-8601>
active_at: <ISO-8601>        # optional — stamped when card first moves to in-progress
done_at: <ISO-8601>          # optional — stamped each time card moves to done
branch: <branch-name>        # optional — set when work starts, cleared after merge
archived_at: <ISO-8601>      # optional — set when archived
---

#tag1 #tag2

# Card Title

Card description and notes in Markdown.
```

- The first line of the body should be a space-separated list of `#tags`.
- The card title is the first H1 (`#`) heading.
- Everything after the title is free-form Markdown.

## Scripts & Hooks

- `scripts/card-reviewed.js` — Fires when a card moves to Review.
- `scripts/wip-alert.js` — Fires when a WIP limit is exceeded.
- `scripts/card-created.js` — Fires when a new card is created.
- `scripts/card-edited.js` — Fires when a card's content changes.
- `scripts/card-deleted.js` — Fires when a card is deleted.
- `scripts/card-moved.js` — Fires when a card moves between columns.
- `scripts/cards-archived.js` — Fires after Done cards are archived.

Scripts receive a JSON payload via stdin. Shared helpers (notifications, payload parsing) are in `scripts/lib.js`.

Customize or add scripts in `.vscode/settings.json` under `personal-kanban.scripts` and `personal-kanban.hooks`.

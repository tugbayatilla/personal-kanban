# Kanban Board Guidelines

## Purpose

This board visualises the flow of work from idea to done. The goal is not to track tasks — it is to expose bottlenecks, limit multitasking, and deliver work at a sustainable, predictable pace.

---

## Columns & Flow

Work moves left → right through the value stream. Each column has a distinct meaning and entry policy.

| Column | Type | Purpose |
|--------|------|---------|
| Backlog | Queue | Unfiltered pool of options. No commitment. |
| Refined | Queue | Ready to pull. Scoped, understood, small enough to complete. |
| In Progress | Active | Being worked on right now. Subject to WIP limits. |
| Review | Active | Work done, awaiting verification or acceptance. |
| Done | Closed | Accepted and complete. Archived periodically. |

**Queues** (Backlog, Refined) accumulate demand. **Active** columns should always respect WIP limits.

---

## WIP Limits

WIP (Work In Progress) limits are the core control mechanism of Kanban. They make the system pull-based rather than push-based.

- **In Progress:** limit 2 (recommended). Start new work only when a slot is free.
- **Review:** limit 3. If Review is full, help unblock items there before starting anything new.
- Limits are enforced via `wip.violated` hook → `scripts/wip-alert.js`.

**When a WIP limit is hit, stop starting. Start finishing.**

---

## Policies

Policies make implicit agreements explicit. They remove ambiguity about how cards are handled.

### Entry Policies (when a card may enter a column)

| Column | Entry criteria |
|--------|---------------|
| Refined | Card has a clear, actionable description. Scope is understood. It can be completed in one session or day. |
| In Progress | A WIP slot is available. The card is in Refined. The person picking it up has no other active card. |
| Review | Work is complete. All acceptance criteria are met from the worker's perspective. |
| Done | A second person (or the same person after a pause) has verified the outcome. |

### Exit Policies (when a card may leave a column)

- A card leaves **In Progress** only when the work is genuinely complete — not "mostly done."
- A card leaves **Review** only when it passes verification, not just when time passes.
- If work is blocked, mark it blocked on the card and pull the next item. Do not leave it silently stalled.

### Blocked Cards

Add a `#blocked` tag and a brief note explaining the blocker. A blocked card counts toward WIP. Remove the blocker or escalate — do not let blocked cards age silently.

---

## Flow Metrics

Track these to understand and improve the system over time.

| Metric | What it tells you |
|--------|------------------|
| **Cycle time** | Time from In Progress → Done. Measures delivery speed. |
| **Lead time** | Time from Backlog → Done. Measures end-to-end responsiveness. |
| **Throughput** | Cards completed per week. Measures sustainable pace. |
| **Queue age** | How long cards sit in Refined without being pulled. Reveals over-commitment or poor refinement. |

Aim for short, consistent cycle times over high throughput. Spikes in cycle time signal blockers or tasks that are too large.

---

## Feedback Loops

Kanban improves through regular inspection of the system itself.

### Daily (async)
- Scan the board for stalled cards (no movement in 24 h on active columns).
- Unblock or escalate anything that is stuck.

### Weekly Replenishment
- Pull items from Backlog into Refined to keep the Refined queue healthy (3–5 items ready).
- Discard or defer Backlog items that are no longer relevant.
- Do not over-refine — refine just enough to be ready to pull.

### Retrospective (on demand or after a run of completions)
- Review cycle times: are items taking longer than expected?
- Review the Done column before archiving: were these the right things to work on?
- Adjust WIP limits or policies if the system is not flowing.

---

## Tags

Tags describe the nature of the work. Use one primary tag per card.

| Tag | Meaning |
|-----|---------|
| `feature` | New capability or behaviour. |
| `bug` | Something broken that needs fixing. |
| `chore` | Maintenance, housekeeping, dependency updates. |
| `spike` | Time-boxed research or exploration. Output is knowledge, not code. |
| `urgent` | Must be resolved before other work. Use sparingly — overuse dilutes the signal. |
| `blocked` | Work cannot proceed. Requires a note explaining the blocker. |

---

## Automation & Hooks

Scripts in `scripts/` fire automatically in response to board events. They are for notifications and policy enforcement — not for tracking state outside the board.

| Hook event | Script | Fires when |
|------------|--------|------------|
| `wip.violated` | `wip-alert.js` | A WIP limit is exceeded |
| `card.created` | `card-created.js` | A new card is created |
| `card.moved` | `card-moved.js` | A card changes column |
| `card.moved` | `card-reviewed.js` | A card enters Review |
| `card.moved` | `card-done.js` | A card enters Done |
| `card.moved` | `policy-violation.js` | A card move violates an entry policy |
| `card.edited` | `card-edited.js` | A card's content changes |
| `card.deleted` | `card-deleted.js` | A card is deleted |
| `cards.archived` | `cards-archived.js` | Done cards are archived |

Scripts receive a JSON payload via stdin. Shared helpers are in `scripts/lib.js`.

---

## Archiving

Archive Done cards regularly to keep the board readable. Archived cards are stored in `archive/` and remain searchable. Archive is not deletion — it is the historical record of completed work.

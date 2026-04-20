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
- Limits are enforced via the `wip-limit` board policy → `scripts/policy-wip-limit.js`.

**When a WIP limit is hit, stop starting. Start finishing.**

---

## Policies

Policies make implicit agreements explicit. They remove ambiguity about how cards are handled. Policies are **config-driven** — defined once in `manifest.json` and referenced where they apply.

### Defining Policies

Policies are defined in the `policies` registry in `manifest.json`. Each entry has a `description` (for readers), a `message` (shown in the approval dialog), and an optional `script` path:

```json
"policies": {
  "no-pullback": {
    "description": "Cards must not move backward in the value stream.",
    "message": "Moving a card backward is a policy violation. Add a note instead.",
    "script": "scripts/policy-no-pullback.js"
  },
  "entry:review": {
    "description": "All acceptance criteria must be met before entering Review.",
    "message": "Card is not ready for Review — all acceptance criteria must be met first.",
    "script": "scripts/policy-entry-review.js"
  }
}
```

The `script` is a Node.js script that receives the move payload as JSON on stdin and exits:
- **`0`** — policy is satisfied, move proceeds silently.
- **non-zero** — policy is violated. A VS Code approval dialog shows the `message`. The user must click **Continue Anyway** to proceed, or cancel to abort the move.

Policies without a `script` are documentation only — they have no runtime effect.

### Applying Policies

Once defined, reference policies by key in two places:

- **`board_policies`** — apply to every card move on the board (global):
  ```json
  "board_policies": ["no-pullback"]
  ```

- **`columns[].policies`** — apply when a card enters that specific column:
  ```json
  { "id": "review", "policies": ["entry:review"] }
  ```

To add a policy: add it to the `policies` registry, then reference its key in `board_policies` or the relevant column. To remove a policy: remove its key from wherever it is referenced (the definition in `policies` can stay as documentation).

### Policy Scripts

Policy scripts receive this payload on stdin:

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Always `"card.moving"` |
| `timestamp` | string | ISO 8601 datetime of the move attempt |
| `card_id` | string | Card file id (e.g. `"20260101-a1b2"`) |
| `card_title` | string | First `# heading` from the card content |
| `from_column` | string | Column id the card is leaving |
| `to_column` | string | Column id the card is entering |
| `to_column_card_count` | number | Current number of cards in the destination column |
| `to_column_wip_limit` | number\|null | WIP limit of the destination column, or `null` if unset |
| `columns` | string[] | Ordered array of all column ids (left → right) |
| `policy` | string | Key of the policy being checked (e.g. `"entry:done"`) |

The `columns` array gives scripts the full column order so they can determine move direction without reading the manifest. Use `readPayload` from `lib.js` to parse the payload.

```js
const { readPayload, readCard } = require('./lib');
const path = require('path');

readPayload('my-policy', ({ card_id, from_column, to_column, columns }) => {
  // exit 0 = ok, exit 1 = violated
  process.exit(0);
});
```

### Bypassing Policies

Some cards legitimately need to skip all policy checks — urgent fixes, escalations, or expedited work. Add a bypass tag to the card to suppress all policy dialogs for that move.

Bypass tags are configured in `manifest.json`:

```json
"policy_bypass_tags": ["no-policy", "expedite"]
```

Any card tagged with `#no-policy` or `#expedite` will move freely without triggering any policy script. To add more bypass tags, append them to the array. To disable bypassing entirely, set the array to `[]`.

Use bypass tags sparingly. Frequent use signals that a policy is too strict or poorly defined.

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
| `expedite` | Bypasses all policy checks on move. Reserved for urgent escalations. |
| `no-policy` | Bypasses all policy checks on move. Use for exceptions that don't fit normal flow. |

---

## Automation & Hooks

Scripts in `scripts/` fire automatically in response to board events. They are for notifications and policy enforcement — not for tracking state outside the board.

| Hook event | Script | Fires when |
|------------|--------|------------|
| `policy.overridden` | `policy-overridden.js` | A policy was violated, user approved, move proceeded |
| `card.created` | `card-created.js` | A new card is created |
| `card.moved` | `card-moved.js` | A card changes column (handles Review and Done notifications too) |
| `card.edited` | `card-edited.js` | A card's content changes |
| `card.deleted` | `card-deleted.js` | A card is deleted |
| `cards.archived` | `cards-archived.js` | Done cards are archived |

Scripts receive a JSON payload via stdin. Shared helpers are in `scripts/lib.js`. Use `readPayload` to parse stdin and `readCard` / `updateCardMetadata` for card file access.

### Hook Payloads

All hook payloads include `event`, `timestamp`, and `notifications` (boolean — whether desktop notifications are enabled). Additional fields per event:

**`card.created`**

| Field | Description |
|-------|-------------|
| `card_id` | New card id |
| `card_title` | Empty string (card has no content yet) |
| `column` | Column the card was created in |
| `card_path` | Relative path to card file, e.g. `"cards/20260101-a1b2.md"` |

**`card.edited`**

| Field | Description |
|-------|-------------|
| `card_id` | Card id |
| `card_title` | Extracted title after the edit |
| `card_path` | Relative path to card file |

**`card.deleted`**

| Field | Description |
|-------|-------------|
| `card_id` | Card id |
| `card_title` | Title at time of deletion |
| `last_column` | Column the card was in when deleted |

**`card.moved`**

| Field | Description |
|-------|-------------|
| `card_id` | Card id |
| `card_title` | Card title |
| `from_column` | Column the card left |
| `to_column` | Column the card entered |
| `branch` | Value of the `branch` metadata field, if set |
| `card_path` | Relative path to card file |

**`policy.overridden`**

| Field | Description |
|-------|-------------|
| `card_id` | Card id |
| `card_title` | Card title |
| `from_column` | Column the card left |
| `to_column` | Column the card entered |
| `policy` | Policy key that was violated (e.g. `"entry:done"`) |
| `message` | The human-readable violation message shown to the user |

**`cards.archived`**

| Field | Description |
|-------|-------------|
| `column` | Column that was archived (the done column) |

---

## Archiving

Archive Done cards regularly to keep the board readable. Archived cards are stored in `archive/` and remain searchable. Archive is not deletion — it is the historical record of completed work.

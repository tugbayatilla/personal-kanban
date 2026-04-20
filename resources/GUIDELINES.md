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

Column ids, labels, order, and WIP limits are all defined in `manifest.json` under `columns`. The board renders whatever is there — no column names are hard-coded in the extension.

---

## WIP Limits

WIP (Work In Progress) limits are the core control mechanism of Kanban. They make the system pull-based rather than push-based.

- **In Progress:** limit 2 (recommended). Start new work only when a slot is free.
- **Review:** limit 3. If Review is full, help unblock items there before starting anything new.
- Limits are enforced via the `wip-limit` board policy → `scripts/policy-wip-limit.js`.

**When a WIP limit is hit, stop starting. Start finishing.**

---

## Card Metadata

Every card carries a YAML frontmatter block. Fields are written automatically by the extension and hook scripts — you can also edit them directly in the card file.

### Timestamps

Two timestamps are written automatically when a card enters specific columns. Which columns trigger them is configured in `manifest.json` under `column_stamps`:

```json
"column_stamps": {
  "active_at": "in-progress",
  "done_at": "done"
}
```

| Field | Behaviour |
|-------|-----------|
| `active_at` | Stamped the **first time** a card enters the configured column. Never overwritten on subsequent moves back. |
| `done_at` | Stamped **every time** a card enters the configured column. |

These values are used by flow metrics tools to calculate cycle time and lead time. To disable a stamp, remove its key. To point it at a different column, change the value to any valid column id.

The archive operation (see [Archiving](#archiving)) also uses `column_stamps.done_at` to determine which column to sweep — so changing the done column id here updates both behaviours at once.

### People

Three fields capture who touched the card at key lifecycle moments. They are written automatically from `git config user.name` and `git config user.email` and are silently skipped if git is unavailable or the user is not configured.

| Field | Set when | Value |
|-------|----------|-------|
| `created_by` | Card is created | Git user who created it |
| `active_by` | Card enters `column_stamps.active_at` | Git user who started work |
| `done_by` | Card enters `column_stamps.done_at` | Git user who accepted it |
| `archived_by` | Card is archived | Git user who ran the archive operation |

Format is `"Name <email>"`, `"Name"`, or `"<email>"` depending on what is configured. In a solo workflow all four will typically be the same person. In a team workflow `done_by` will differ from `created_by` and `active_by`.

These fields are written by `scripts/card-created.js`, `scripts/card-moved.js`, and the extension's archive operation. You can customise the script logic — for example to write only the email, or to skip stamping under certain conditions.

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
| **Cycle time** | Time from `active_at` → `done_at`. Measures delivery speed. |
| **Lead time** | Time from `created_at` → `done_at`. Measures end-to-end responsiveness. |
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

Scripts in `scripts/` fire automatically in response to board events. They are for notifications and post-move side effects — not for tracking state outside the board.

| Hook event | Script | Fires when |
|------------|--------|------------|
| `card.created` | `card-created.js` | A new card is created |
| `card.edited` | `card-edited.js` | A card's content changes |
| `card.deleted` | `card-deleted.js` | A card is deleted |
| `card.moved` | `card-moved.js` | A card changes column |
| `policy.overridden` | `policy-overridden.js` | A policy was violated, user approved, move proceeded |
| `cards.archived` | `cards-archived.js` | Done cards are archived |

Scripts receive a JSON payload via stdin. Shared helpers are in `scripts/lib.js`. Use `readPayload` to parse stdin and `readCard` / `updateCardMetadata` for card file access.

### Accessing Full Card Metadata

Payloads only include a subset of card fields. To access the full metadata — including `created_by`, `active_by`, `done_by`, `archived_by`, `branch`, and any custom fields you have added to the card's frontmatter — call `readCard(card_path)` inside any hook or policy script:

```js
const { readPayload, readCard } = require('./lib');

readPayload('card-moved', ({ card_path }) => {
  const card = readCard(card_path);

  // Standard lifecycle fields:
  console.log(card.metadata.created_by);
  console.log(card.metadata.active_by);
  console.log(card.metadata.done_by);
  console.log(card.metadata.archived_by);
  console.log(card.metadata.branch);

  // Any custom field from the card's frontmatter:
  console.log(card.metadata.my_custom_field);

  // Enumerate everything:
  for (const [key, value] of Object.entries(card.metadata)) {
    console.log(key, value);
  }
});
```

`CardMetadata` has an index signature (`[key: string]: string | undefined`), so any frontmatter field you add to a card is automatically accessible via `card.metadata.your_field` — no schema changes required.

**Policy scripts** do not receive `card_path` in their payload. Reconstruct it from `card_id`:

```js
const { readPayload, readCard } = require('./lib');

readPayload('my-policy', ({ card_id }) => {
  const card = readCard(`cards/${card_id}.md`);
  // card.metadata has everything
  process.exit(0);
});
```

### Hook Payloads

All hook payloads include three common fields:

| Field | Description |
|-------|-------------|
| `event` | The event name (e.g. `"card.moved"`) |
| `timestamp` | ISO 8601 datetime the event fired |
| `notifications` | Boolean — whether desktop notifications are enabled in VS Code settings |

Additional fields per event:

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
| `column` | Column that was swept — the id configured in `column_stamps.done_at` |

---

## Archiving

Archive Done cards regularly to keep the board readable. Archived card files are moved to `archive/` and stamped with `archived_at`. Archive is not deletion — it is the historical record of completed work.

The column to archive from is determined by `column_stamps.done_at` in `manifest.json`. Changing that value redirects both the `done_at` timestamp and the archive sweep to the new column id.

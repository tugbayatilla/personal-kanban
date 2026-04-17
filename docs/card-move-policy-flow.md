# Card Move & Policy Execution Flow

This document describes what happens internally when a card is dragged to a new column, from the drag event in the webview through policy checks, user approval, disk write, and hook firing.

---

## High-Level Order of Events

```
drag drop  →  moveCard msg  →  bypass check  →  policy scripts  →  approval dialogs
    →  disk write  →  hooks fired  →  webview refresh
```

The key invariant: **nothing is written to disk until all policy scripts pass or the user approves every violation.**

---

## Step-by-Step

### 1. Drag & Drop — `media/board.js`

`setupDragSource()` captures the card id and source column on `dragstart`.

On `drop`, `setupDropZone()` calculates the insertion index from the placeholder position and sends a message to the extension:

```js
vscode.postMessage({
  type: 'moveCard',
  id: draggedId,
  fromColumn: draggedFromColumn,
  toColumn: columnId,
  toIndex: toIndex,
});
```

---

### 2. Message Reception — `src/BoardPanel.ts:185`

The `case 'moveCard'` handler begins. It reads the current manifest and card state from disk to build the policy payload **before** any changes are made.

```ts
// BoardPanel.ts:191-200
const basePayload = {
  event: 'card.moving',
  timestamp: new Date().toISOString(),
  card_id: msg.id,
  card_title: preCard ? extractTitle(preCard.content) : '',
  from_column: msg.fromColumn,
  to_column: msg.toColumn,
  to_column_card_count: dstColPre?.cards?.length ?? 0,
  to_column_wip_limit: dstColPre?.wip_limit ?? null,
};
```

---

### 3. Bypass Tag Check — `BoardPanel.ts:201-208`

Before running any policy scripts, the handler checks whether the card carries a bypass tag.

```ts
const bypassTags = preManifest.policy_bypass_tags ?? [];
const bypassedBy = bypassTags.length > 0 && preCard
  ? cardHasBypassTag(preCard.content, bypassTags)
  : null;
```

`cardHasBypassTag()` (`BoardPanel.ts:400`) extracts all `#tag` patterns from the card's markdown content and compares them (case-insensitive) against `manifest.policy_bypass_tags`. The first match wins.

If a bypass tag is found, `violations` is set to `[]` and **all policy scripts are skipped**. The bypass is logged to the output channel.

---

### 4. Policy Script Execution — `BoardPanel.ts:210-212`, `checkPolicies():424`

If not bypassed:

```ts
const violations = await checkPolicies(boardRoot, preManifest, fromColumn, toColumn, basePayload);
```

`checkPolicies()` builds the list of applicable policy keys:

```ts
const keys = [
  ...(manifest.board_policies ?? []),                              // board-wide, every move
  ...(manifest.columns.find(c => c.id === toColumn)?.policies ?? []),  // column-specific, entry only
];
```

For each key it looks up the policy definition in `manifest.policies`, then calls `runPolicyScript()` (`hooks.ts:88`).

#### `runPolicyScript()` — `src/hooks.ts:88`

- Spawns a Node.js child process: `node <absScript>`
- Writes the JSON payload to the script's `stdin`, then closes it
- Waits for the process to exit
- **Exit code `0`** → no violation, move may continue
- **Exit code non-zero** → policy violated, message collected
- If the script cannot be spawned, the policy is treated as **not violated** (permissive default — a broken script must never silently block all moves)

The payload each policy script receives:

```json
{
  "event": "card.moving",
  "timestamp": "2026-04-17T10:00:00.000Z",
  "card_id": "20260417-abc1",
  "card_title": "Task Title",
  "from_column": "in-progress",
  "to_column": "done",
  "to_column_card_count": 2,
  "to_column_wip_limit": 5,
  "columns": ["backlog", "refined", "in-progress", "review", "done"],
  "policy": "entry:done"
}
```

Scripts run **sequentially** in the order their keys appear in the merged array. All violations are collected before the next step.

---

### 5. Approval Dialogs — `BoardPanel.ts:214-226`

For each collected violation, VS Code shows a modal warning:

```ts
const choice = await vscode.window.showWarningMessage(
  violation.message,
  { modal: true },
  'Continue Anyway'
);
if (choice !== 'Continue Anyway') {
  this._sendState();   // refresh webview → card snaps back visually
  return;              // abort — nothing written to disk
}
```

If the user dismisses the dialog or clicks outside it without choosing "Continue Anyway", the move is **aborted**. `_sendState()` pushes the unchanged board state to the webview so the card animates back to its original column.

If the user approves every dialog, execution continues to the commit step.

---

### 6. Committing the Move — `BoardPanel.ts:228-260`

Only after all approvals:

```ts
this._suppressWatch();   // prevent self-triggered file-watcher reload
const { movedCard, manifest } = withLock(this._boardRoot, () => {
  // reload state inside lock to avoid TOCTOU races
  const card = readCard(this._boardRoot, msg.id);
  card.metadata.column = msg.toColumn;
  card.metadata.order  = String(calcOrder(prevOrder, nextOrder));
  // timestamps set automatically:
  //   active_at — set when entering 'in-progress' (first time only)
  //   done_at   — set when entering 'done'
  writeCard(this._boardRoot, card);
  return { movedCard: card, manifest };
});
```

`withLock()` creates an exclusive lock file (`.personal-kanban/manifest.lock`) for the duration of the write. `writeCard()` uses an atomic write-to-temp-then-rename pattern so no partial writes reach disk on crash.

---

### 7. Hook Firing — `BoardPanel.ts:262-285`, `src/hooks.ts:141`

After the write, two kinds of hooks fire:

**`policy.overridden`** — fired once per approved violation (only when violations existed):

```ts
fireHook(boardRoot, manifest, 'policy.overridden', {
  card_id, card_title, from_column, to_column,
  policy: violation.policy,
  message: violation.message,
});
```

**`card.moved`** — always fired on a successful move:

```ts
fireHook(boardRoot, manifest, 'card.moved', {
  card_id, card_title, from_column, to_column,
  branch: movedCard.metadata.branch,
  card_path: `cards/${msg.id}.md`,
});
```

`fireHook()` is **fire-and-forget** — it launches the hook chain asynchronously and does not block the move. Hook scripts run sequentially; a non-zero exit code from any script stops the rest of the chain for that event.

---

### 8. Webview Refresh — `BoardPanel.ts:287`

```ts
this._sendState();
```

Reloads the full board state from disk and pushes it to the webview. The card renders in its new column.

---

## Data Flow Diagram

```
board.js                    BoardPanel.ts               hooks.ts / disk
────────                    ─────────────               ───────────────
dragstart
  store id, fromColumn
drop
  calc toIndex
  postMessage(moveCard) ──► case 'moveCard'
                              read manifest + card
                              build basePayload
                              check bypass tags
                                 └─ bypassed? ──────────────────────────► skip policies
                              checkPolicies()
                                 └─ for each policy key
                                      runPolicyScript() ───────────────► spawn node <script>
                                                                          write JSON → stdin
                                                                          wait exit code
                                                         ◄─────────────  exit 0 / non-zero
                              for each violation
                                showWarningMessage()
                                  └─ cancelled? ──────► _sendState()
                                                         return (abort)
                              withLock()
                                writeCard() ────────────────────────────► atomic write to disk
                              fireHook(policy.overridden) ─────────────► async hook chain
                              fireHook(card.moved) ────────────────────► async hook chain
                              _sendState() ──────────►
                                                        re-render board
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Policies run before the write | Avoids any need to roll back disk state on rejection |
| Spawn fail = not violated | A missing or broken script must never silently block moves |
| Bypass tags short-circuit everything | Lets urgent or trusted moves skip policy overhead entirely |
| `withLock()` re-reads state inside lock | Prevents TOCTOU: another client could have changed the manifest between the pre-read and the write |
| Hooks are fire-and-forget | Hook latency must not delay the UI response |
| `_suppressWatch()` before write | Prevents the extension's own file watcher from triggering a duplicate reload |

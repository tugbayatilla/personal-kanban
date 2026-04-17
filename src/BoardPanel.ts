import * as vscode from 'vscode';
import {
  getBoardRoot,
  readManifest,
  readCard,
  writeCard,
  archiveCardFile,
  deleteCardFile,
  generateId,
  loadBoardState,
  withLock,
  calcOrder,
} from './io';
import { Card, WebviewMessage } from './types';
import { fireHook, runPolicyScript, logInfo, extractTitle } from './hooks';

export class BoardPanel {
  public static currentPanel: BoardPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _boardRoot: string;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  /** Suppress watcher-triggered reloads until this timestamp (ms). */
  private _suppressWatchUntil = 0;

  public static createOrShow(context: vscode.ExtensionContext, workspaceRoot: string, channel: vscode.OutputChannel): void {
    if (BoardPanel.currentPanel) {
      BoardPanel.currentPanel._panel.reveal();
      channel.show(true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'kanbanBoard',
      'Kanban Board',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      }
    );
    BoardPanel.currentPanel = new BoardPanel(panel, workspaceRoot, context.extensionUri);
    context.subscriptions.push({ dispose: () => BoardPanel.currentPanel?._dispose() });
    channel.show(true);
  }

  private constructor(panel: vscode.WebviewPanel, workspaceRoot: string, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._boardRoot = getBoardRoot(workspaceRoot);
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
    this._panel.onDidChangeViewState(
      (e) => { if (e.webviewPanel.visible) this._sendState(); },
      null,
      this._disposables
    );
    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this._handleMessage(msg),
      null,
      this._disposables
    );

    this._panel.webview.html = this._getHtml();
    this._startWatcher();
  }

  private _sendState(editCardId?: string): void {
    try {
      const { manifest, cards } = withLock(this._boardRoot, () => loadBoardState(this._boardRoot));
      this._panel.webview.postMessage({ type: 'setState', manifest, cards, editCardId });
    } catch (err) {
      this._panel.webview.postMessage({
        type: 'setState',
        manifest: null,
        cards: {},
        error: String(err),
      });
    }
  }

  /** Suppress watcher-triggered reloads for the next 1 second. */
  private _suppressWatch(): void {
    this._suppressWatchUntil = Date.now() + 1000;
  }

  private async _handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready': {
        this._sendState();
        break;
      }

      // ── Add card ────────────────────────────────────────────────────────────
      // Card column is written into the card's own metadata — no manifest write needed.
      // New card is appended to the end of the column (order = midpoint of last card and 1).
      case 'addCard': {
        const id = generateId();
        const now = new Date().toISOString();

        this._suppressWatch();
        const { manifest } = withLock(this._boardRoot, () => {
          const { manifest, cards } = loadBoardState(this._boardRoot);
          const col = manifest.columns.find((c) => c.id === msg.columnId);
          const colCards = col?.cards ?? [];

          // Place new card at the end of the column.
          const lastOrder = colCards.length > 0
            ? parseFloat(cards[colCards[colCards.length - 1]]?.metadata.order ?? '0') || 0
            : 0;
          const order = calcOrder(lastOrder, 1);

          const card: Card = {
            id,
            content: '',
            metadata: {
              created_at: now,
              column: msg.columnId,
              order: String(order),
            },
          };
          writeCard(this._boardRoot, card);
          return { manifest };
        });

        fireHook(this._boardRoot, manifest, 'card.created', {
          card_id: id,
          card_title: '',
          column: msg.columnId,
          card_path: `cards/${id}.md`,
        });
        this._sendState(id);
        break;
      }

      // ── Save card ───────────────────────────────────────────────────────────
      case 'saveCard': {
        const existing = readCard(this._boardRoot, msg.id);
        if (existing && existing.content !== msg.content) {
          this._suppressWatch();
          existing.content = msg.content;
          writeCard(this._boardRoot, existing);
          const manifest = readManifest(this._boardRoot);
          fireHook(this._boardRoot, manifest, 'card.edited', {
            card_id: msg.id,
            card_title: extractTitle(msg.content),
            card_path: `cards/${msg.id}.md`,
          });
        }
        this._sendState();
        break;
      }

      // ── Delete card ─────────────────────────────────────────────────────────
      // Column is read from the card's own metadata — no manifest search needed.
      case 'deleteCard': {
        this._suppressWatch();
        const { manifest, deletedTitle, deletedFromColumn } = withLock(this._boardRoot, () => {
          const manifest = readManifest(this._boardRoot);
          const card = readCard(this._boardRoot, msg.id);
          const title = card ? extractTitle(card.content) : '';
          const fromColumn = card?.metadata.column ?? '';
          deleteCardFile(this._boardRoot, msg.id);
          return { manifest, deletedTitle: title, deletedFromColumn: fromColumn };
        });
        fireHook(this._boardRoot, manifest, 'card.deleted', {
          card_id: msg.id,
          card_title: deletedTitle,
          last_column: deletedFromColumn,
        });
        this._sendState();
        break;
      }

      // ── Move card ───────────────────────────────────────────────────────────
      // Writes `column` and `order` into the moved card's file only.
      // No other cards are modified. No manifest write.
      //
      // Order calculation (midpoint / fractional indexing):
      //   newOrder = (prevOrder + nextOrder) / 2
      //   prevOrder = order of the card above insertion point (0 if inserting at top)
      //   nextOrder = order of the card below insertion point (1 if inserting at bottom)
      //   Lower value = higher position (top of column).
      case 'moveCard': {
        // Step 1: Run policy scripts before committing. All logic is in scripts — the
        // extension only orchestrates: run scripts, collect violations, prompt, commit.
        const { manifest: preManifest } = loadBoardState(this._boardRoot);
        const preCard = readCard(this._boardRoot, msg.id);
        const dstColPre = preManifest.columns.find((c) => c.id === msg.toColumn);
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
        const bypassTags = preManifest.policy_bypass_tags ?? [];
        const bypassedBy = bypassTags.length > 0 && preCard
          ? cardHasBypassTag(preCard.content, bypassTags)
          : null;

        if (bypassedBy) {
          logInfo(`[policy.bypassed] card=${msg.id} tag=#${bypassedBy} from=${msg.fromColumn} to=${msg.toColumn} — all policy checks skipped`);
        }

        const violations = bypassedBy
          ? []
          : await checkPolicies(this._boardRoot, preManifest, msg.fromColumn, msg.toColumn, basePayload);

        // Step 2: For each violation ask for approval in order. Any cancellation aborts.
        for (const violation of violations) {
          const choice = await vscode.window.showWarningMessage(
            violation.message,
            { modal: true },
            'Continue Anyway'
          );
          if (choice !== 'Continue Anyway') {
            // Card snaps back visually — send current state to reset the webview.
            this._sendState();
            return;
          }
        }

        // Step 3: Commit the move.
        this._suppressWatch();
        const { movedCard, manifest } = withLock(this._boardRoot, () => {
          const { manifest, cards } = loadBoardState(this._boardRoot);
          const card = readCard(this._boardRoot, msg.id);
          if (!card) return { movedCard: null, manifest };

          // Build destination column card list, excluding the card being moved.
          const dstCol = manifest.columns.find((c) => c.id === msg.toColumn);
          const dstCards = (dstCol?.cards ?? []).filter((cid) => cid !== msg.id);

          const toIdx = Math.max(0, Math.min(msg.toIndex, dstCards.length));
          const prevOrder = toIdx > 0
            ? parseFloat(cards[dstCards[toIdx - 1]]?.metadata.order ?? '0') || 0
            : 0;
          const nextOrder = toIdx < dstCards.length
            ? parseFloat(cards[dstCards[toIdx]]?.metadata.order ?? '1') || 1
            : 1;

          const now = new Date().toISOString();
          card.metadata.column = msg.toColumn;
          card.metadata.order = String(calcOrder(prevOrder, nextOrder));

          if (msg.toColumn === 'in-progress' && !card.metadata.active_at) {
            card.metadata.active_at = now;
          }
          if (msg.toColumn === 'done') {
            card.metadata.done_at = now;
          }

          writeCard(this._boardRoot, card);
          return { movedCard: card, manifest };
        });

        if (movedCard) {
          const movedTitle = extractTitle(movedCard.content);

          // Step 4: Fire policy.overridden for each approved violation.
          for (const violation of violations) {
            fireHook(this._boardRoot, manifest, 'policy.overridden', {
              card_id: msg.id,
              card_title: movedTitle,
              from_column: msg.fromColumn,
              to_column: msg.toColumn,
              policy: violation.policy,
              message: violation.message,
            });
          }

          fireHook(this._boardRoot, manifest, 'card.moved', {
            card_id: msg.id,
            card_title: movedTitle,
            from_column: msg.fromColumn,
            to_column: msg.toColumn,
            branch: movedCard.metadata.branch,
            card_path: `cards/${msg.id}.md`,
          });
        }

        this._sendState();
        break;
      }

      // ── Open card file ──────────────────────────────────────────────────────
      case 'openCardFile': {
        const cardPath = vscode.Uri.file(`${this._boardRoot}/cards/${msg.id}.md`);
        vscode.window.showTextDocument(cardPath);
        break;
      }

      // ── Archive done ────────────────────────────────────────────────────────
      // Done cards are discovered by loading state (scanning card files).
      case 'archiveDone': {
        this._suppressWatch();
        const m4 = withLock(this._boardRoot, () => {
          const { manifest } = loadBoardState(this._boardRoot);
          const doneCol = manifest.columns.find((c) => c.id === 'done');
          if (doneCol && doneCol.cards && doneCol.cards.length > 0) {
            const archivedAt = new Date().toISOString();
            for (const id of doneCol.cards) {
              const card = readCard(this._boardRoot, id);
              if (card) {
                card.metadata.archived_at = archivedAt;
                writeCard(this._boardRoot, card);
              }
              archiveCardFile(this._boardRoot, id);
            }
          }
          return manifest;
        });
        fireHook(this._boardRoot, m4, 'cards.archived', { column: 'done' });
        this._sendState();
        break;
      }
    }
  }

  private _startWatcher(): void {
    const boardDir = vscode.Uri.file(this._boardRoot);
    const onChange = () => {
      if (Date.now() < this._suppressWatchUntil) return;
      this._sendState();
    };

    // Watch manifest.json for external changes (column structure, scripts, hooks).
    const manifestWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(boardDir, 'manifest.json')
    );
    manifestWatcher.onDidChange(onChange, null, this._disposables);
    manifestWatcher.onDidCreate(onChange, null, this._disposables);
    this._disposables.push(manifestWatcher);

    // Watch card files — board state is derived from these in v1.
    // External edits (e.g. changing `column:` via a script) will reload the board.
    const cardsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(boardDir, 'cards/*.md')
    );
    cardsWatcher.onDidChange(onChange, null, this._disposables);
    cardsWatcher.onDidCreate(onChange, null, this._disposables);
    cardsWatcher.onDidDelete(onChange, null, this._disposables);
    this._disposables.push(cardsWatcher);
  }

  private _dispose(): void {
    BoardPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }

  private _getHtml(): string {
    const webview = this._panel.webview;
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'board.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'board.js')
    );
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
<title>Kanban Board</title>
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<div id="board"></div>
<script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// ── Policy bypass ─────────────────────────────────────────────────────────────

/**
 * Returns the first matching bypass tag found in the card content, or null if none.
 * Tags in content are written as #tagname; bypass tags in config are stored without #.
 */
function cardHasBypassTag(content: string, bypassTags: string[]): string | null {
  const found = content.match(/#([\w-]+)/g) ?? [];
  const cardTags = found.map((t) => t.slice(1).toLowerCase());
  return bypassTags.find((t) => cardTags.includes(t.toLowerCase())) ?? null;
}

// ── Policy checking ───────────────────────────────────────────────────────────

interface PolicyViolation {
  policy: string;
  message: string;
}

/**
 * Run all applicable policy scripts for a card move and return violations.
 *
 * Applicable policies are those referenced by:
 *   - manifest.board_policies  — checked on every move
 *   - column.policies          — checked when a card enters that specific column
 *
 * For each policy, if a `script` is defined it is executed with the move payload.
 * Exit code 0 = no violation; non-zero = violated.
 * Policies without a `script` are skipped (documentation only).
 */
async function checkPolicies(
  boardRoot: string,
  manifest: import('./types').Manifest,
  fromColumn: string,
  toColumn: string,
  basePayload: Record<string, unknown>
): Promise<PolicyViolation[]> {
  const registry = manifest.policies ?? {};
  const columns = manifest.columns.map((c) => c.id);
  const violations: PolicyViolation[] = [];

  const keys = [
    ...(manifest.board_policies ?? []),
    ...(manifest.columns.find((c) => c.id === toColumn)?.policies ?? []),
  ];

  for (const key of keys) {
    const def = registry[key];
    if (!def?.script) { continue; }

    const payload = { ...basePayload, columns, policy: key };
    const violated = await runPolicyScript(boardRoot, def.script, payload);
    if (violated) {
      violations.push({ policy: key, message: def.message });
    }
  }

  return violations;
}

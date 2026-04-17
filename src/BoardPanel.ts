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
import { fireHook, extractTitle } from './hooks';

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

          const violation = detectPolicyViolation(msg.fromColumn, msg.toColumn, manifest.columns.map((c) => c.id));
          if (violation) {
            fireHook(this._boardRoot, manifest, 'policy.violated', {
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
          if (msg.toColumn === 'review') {
            fireHook(this._boardRoot, manifest, 'card.reviewed', {
              card_id: msg.id,
              card_title: movedTitle,
              from_column: msg.fromColumn,
              branch: movedCard.metadata.branch,
            });
          }
          // WIP check: reload to get accurate post-move column counts.
          const { manifest: loaded } = loadBoardState(this._boardRoot);
          const dstCol = loaded.columns.find((c) => c.id === msg.toColumn);
          if (dstCol?.wip_limit !== null && dstCol?.wip_limit !== undefined) {
            const count = dstCol.cards?.length ?? 0;
            if (count > dstCol.wip_limit) {
              fireHook(this._boardRoot, manifest, 'wip.violated', {
                column: msg.toColumn,
                wip_limit: dstCol.wip_limit,
                current_count: count,
                card_id: msg.id,
              });
            }
          }
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

// ── Policy violation detection ────────────────────────────────────────────────

interface PolicyViolation {
  policy: string;
  message: string;
}

/**
 * Column-specific entry policies (keyed by destination column id).
 * These fire when a card enters a particular column regardless of where it came from.
 */
const COLUMN_POLICIES: Record<string, { policy: string; message: string }> = {
  'review': {
    policy: 'entry:review',
    message: 'Cards entering Review must have all acceptance criteria met from the worker\'s perspective.',
  },
  'done': {
    policy: 'entry:done',
    message: 'Cards entering Done must have been verified by a second person (or the same person after a pause).',
  },
};

export function detectPolicyViolation(
  fromColumn: string,
  toColumn: string,
  columnOrder: string[]
): PolicyViolation | null {
  const fromIdx = columnOrder.indexOf(fromColumn);
  const toIdx   = columnOrder.indexOf(toColumn);

  // Global policy: pulling a card backward in the value stream.
  if (fromIdx !== -1 && toIdx !== -1 && toIdx < fromIdx) {
    return {
      policy: 'no-pullback',
      message: `Moving a card backward from "${fromColumn}" to "${toColumn}" is a policy violation. Add a note to the card explaining why instead.`,
    };
  }

  // Column-specific entry policy.
  if (COLUMN_POLICIES[toColumn]) {
    return COLUMN_POLICIES[toColumn];
  }

  return null;
}

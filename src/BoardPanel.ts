import * as vscode from 'vscode';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  getBoardRoot,
  readManifest,
  readCard,
  writeCard,
  writeManifest,
  deleteCardFile,
  generateId,
  loadBoardState,
} from './io';
import { Card, WebviewMessage } from './types';
import { fireHook, extractTitle } from './hooks';

export class BoardPanel {
  public static currentPanel: BoardPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _boardRoot: string;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _suppressNextWatch = false;

  public static createOrShow(context: vscode.ExtensionContext, workspaceRoot: string): void {
    if (BoardPanel.currentPanel) {
      BoardPanel.currentPanel._panel.reveal();
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

  private _sendState(): void {
    try {
      const { manifest, cards } = loadBoardState(this._boardRoot);
      this._panel.webview.postMessage({ type: 'setState', manifest, cards });
    } catch (err) {
      this._panel.webview.postMessage({
        type: 'setState',
        manifest: null,
        cards: {},
        error: String(err),
      });
    }
  }

  private async _handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready': {
        this._sendState();
        break;
      }

      case 'addCard': {
        const id = generateId();
        const now = new Date().toISOString();
        const card: Card = {
          id,
          content: '',
          metadata: { created_at: now, updated_at: now },
        };
        writeCard(this._boardRoot, card);
        this._suppressNextWatch = true;
        const m1 = readManifest(this._boardRoot);
        if (!m1.cards[msg.columnId]) m1.cards[msg.columnId] = [];
        m1.cards[msg.columnId].push(id);
        writeManifest(this._boardRoot, m1);
        fireHook(this._boardRoot, m1, 'card.created', {
          card_id: id,
          card_title: '',
          column: msg.columnId,
        });
        this._sendState();
        break;
      }

      case 'saveCard': {
        const existing = readCard(this._boardRoot, msg.id);
        if (existing) {
          existing.content = msg.content;
          writeCard(this._boardRoot, existing);
        }
        this._sendState();
        break;
      }

      case 'deleteCard': {
        this._suppressNextWatch = true;
        const m2 = readManifest(this._boardRoot);
        const deletedCard = readCard(this._boardRoot, msg.id);
        const deletedTitle = deletedCard ? extractTitle(deletedCard.content) : '';
        let deletedFromColumn = '';
        for (const col of m2.columns) {
          const arr = m2.cards[col.id] ?? [];
          const idx = arr.indexOf(msg.id);
          if (idx !== -1) {
            deletedFromColumn = col.id;
            arr.splice(idx, 1);
            m2.cards[col.id] = arr;
            break;
          }
        }
        writeManifest(this._boardRoot, m2);
        deleteCardFile(this._boardRoot, msg.id);
        fireHook(this._boardRoot, m2, 'card.deleted', {
          card_id: msg.id,
          card_title: deletedTitle,
          last_column: deletedFromColumn,
        });
        this._sendState();
        break;
      }

      case 'moveCard': {
        // When moving to done, run git merge workflow if card has a branch
        if (msg.toColumn === 'done') {
          const card = readCard(this._boardRoot, msg.id);
          if (card?.metadata.branch) {
            const branch = card.metadata.branch;
            const confirmed = await vscode.window.showWarningMessage(
              `Merge branch "${branch}" into main and close this card?`,
              { modal: true },
              'Merge'
            );
            if (confirmed !== 'Merge') {
              this._sendState();
              return;
            }
            const workspaceRoot = path.dirname(this._boardRoot);
            try {
              const opts = { cwd: workspaceRoot, stdio: 'pipe' as const };
              execSync('git checkout main', opts);
              execSync('git pull origin main', opts);
              execSync(`git merge --no-ff ${branch} -m "Merge ${branch} into main"`, opts);
              execSync('git push origin main', opts);
              execSync(`git branch -d ${branch}`, opts);
              try { execSync(`git push origin --delete ${branch}`, opts); } catch { /* remote branch may not exist */ }
              delete card.metadata.branch;
              writeCard(this._boardRoot, card);
            } catch (err) {
              vscode.window.showErrorMessage(`Git merge failed: ${String(err)}`);
              this._sendState();
              return;
            }
          }
        }

        this._suppressNextWatch = true;
        const m3 = readManifest(this._boardRoot);
        const movedCard = readCard(this._boardRoot, msg.id);
        const movedTitle = movedCard ? extractTitle(movedCard.content) : '';
        // Remove from source column
        const src = m3.cards[msg.fromColumn] ?? [];
        const srcIdx = src.indexOf(msg.id);
        if (srcIdx !== -1) src.splice(srcIdx, 1);
        m3.cards[msg.fromColumn] = src;
        // Insert at target position
        if (!m3.cards[msg.toColumn]) m3.cards[msg.toColumn] = [];
        const dst = m3.cards[msg.toColumn];
        const toIdx = Math.max(0, Math.min(msg.toIndex, dst.length));
        dst.splice(toIdx, 0, msg.id);
        m3.cards[msg.toColumn] = dst;
        writeManifest(this._boardRoot, m3);
        fireHook(this._boardRoot, m3, 'card.moved', {
          card_id: msg.id,
          card_title: movedTitle,
          from_column: msg.fromColumn,
          to_column: msg.toColumn,
        });
        const destColumn = m3.columns.find((c) => c.id === msg.toColumn);
        if (destColumn?.wip_limit !== null && destColumn?.wip_limit !== undefined) {
          const destCount = m3.cards[msg.toColumn]?.length ?? 0;
          if (destCount > destColumn.wip_limit) {
            fireHook(this._boardRoot, m3, 'wip.violated', {
              column: msg.toColumn,
              wip_limit: destColumn.wip_limit,
              current_count: destCount,
              card_id: msg.id,
            });
          }
        }
        this._sendState();
        break;
      }
    }
  }

  private _startWatcher(): void {
    const manifestDir = vscode.Uri.file(this._boardRoot);
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(manifestDir, 'manifest.json')
    );
    const onChange = () => {
      if (this._suppressNextWatch) {
        this._suppressNextWatch = false;
        return;
      }
      this._sendState();
    };
    watcher.onDidChange(onChange, null, this._disposables);
    watcher.onDidCreate(onChange, null, this._disposables);
    this._disposables.push(watcher);
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

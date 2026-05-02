import * as vscode from 'vscode';
import { getBoardRoot, readManifest } from './io';
import { loadAllCardFiles } from './metrics';

export class MetricsPanel {
  public static currentPanel: MetricsPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _boardRoot: string;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(context: vscode.ExtensionContext, workspaceRoot: string): void {
    if (MetricsPanel.currentPanel) {
      MetricsPanel.currentPanel._panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'kanbanMetrics',
      'Kanban Metrics',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      }
    );
    MetricsPanel.currentPanel = new MetricsPanel(panel, workspaceRoot, context.extensionUri);
    context.subscriptions.push({ dispose: () => MetricsPanel.currentPanel?._dispose() });
  }

  private constructor(panel: vscode.WebviewPanel, workspaceRoot: string, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._boardRoot = getBoardRoot(workspaceRoot);
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
    this._panel.onDidChangeViewState(
      (e) => { if (e.webviewPanel.visible) this._sendData(); },
      null,
      this._disposables
    );
    this._panel.webview.onDidReceiveMessage(
      (msg: { type: string }) => {
        if (msg.type === 'ready' || msg.type === 'refresh') this._sendData();
      },
      null,
      this._disposables
    );

    this._panel.webview.html = this._getHtml();
  }

  private _sendData(): void {
    try {
      const manifest = readManifest(this._boardRoot);
      const cards = loadAllCardFiles(this._boardRoot);
      const columns = manifest.columns.map((c) => ({ id: c.id, label: c.label }));
      this._panel.webview.postMessage({ type: 'setData', cards, columns });
    } catch (err) {
      this._panel.webview.postMessage({ type: 'setData', cards: [], columns: [], error: String(err) });
    }
  }

  private _dispose(): void {
    MetricsPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }

  private _getHtml(): string {
    const webview = this._panel.webview;
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'metrics.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'metrics.js')
    );
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
<title>Kanban Metrics</title>
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<div id="metrics-root">
  <div id="metrics-header"></div>
  <div id="metrics-content"></div>
</div>
<script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

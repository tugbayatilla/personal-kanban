import * as vscode from 'vscode';
import * as crypto from 'crypto';
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

export class BoardPanel {
  public static currentPanel: BoardPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _boardRoot: string;
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
      { enableScripts: true, retainContextWhenHidden: true }
    );
    BoardPanel.currentPanel = new BoardPanel(panel, workspaceRoot);
    context.subscriptions.push({ dispose: () => BoardPanel.currentPanel?._dispose() });
  }

  private constructor(panel: vscode.WebviewPanel, workspaceRoot: string) {
    this._panel = panel;
    this._boardRoot = getBoardRoot(workspaceRoot);

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

    const nonce = crypto.randomBytes(16).toString('hex');
    this._panel.webview.html = this._getHtml(nonce);

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

  private _handleMessage(msg: WebviewMessage): void {
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
        for (const col of m2.columns) {
          const arr = m2.cards[col.id] ?? [];
          const idx = arr.indexOf(msg.id);
          if (idx !== -1) {
            arr.splice(idx, 1);
            m2.cards[col.id] = arr;
            break;
          }
        }
        writeManifest(this._boardRoot, m2);
        deleteCardFile(this._boardRoot, msg.id);
        this._sendState();
        break;
      }

      case 'moveCard': {
        this._suppressNextWatch = true;
        const m3 = readManifest(this._boardRoot);
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

  private _getHtml(nonce: string): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Kanban Board</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    height: 100vh;
    overflow: hidden;
  }

  #board {
    display: flex;
    flex-direction: row;
    gap: 12px;
    padding: 16px;
    height: 100vh;
    overflow-x: auto;
    overflow-y: hidden;
    align-items: flex-start;
  }

  .column {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 270px;
    background: var(--vscode-sideBar-background, rgba(128,128,128,0.08));
    border-radius: 8px;
    padding: 10px;
    height: calc(100vh - 32px);
    border: 2px solid transparent;
    transition: border-color 0.15s;
  }

  .column.drag-over {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .column-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
    flex-shrink: 0;
  }

  .column-title {
    font-weight: 600;
    font-size: 13px;
  }

  .card-count {
    background: var(--vscode-badge-background, rgba(128,128,128,0.4));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
    border-radius: 10px;
    padding: 1px 8px;
    font-size: 11px;
    font-weight: 600;
  }

  .cards {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 2px 1px;
    min-height: 0;
  }

  .card {
    position: relative;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
    border-radius: 6px;
    padding: 10px 30px 10px 10px;
    cursor: default;
    user-select: none;
    flex-shrink: 0;
  }

  .card:hover {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .card:hover .delete-btn {
    opacity: 1;
  }

  .card.dragging {
    opacity: 0.4;
  }

  .card-title {
    font-size: 13px;
    line-height: 1.5;
    word-break: break-word;
    white-space: pre-wrap;
  }

  .card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .tag-chip {
    font-size: 11px;
    background: var(--vscode-badge-background, rgba(128,128,128,0.3));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
    border-radius: 3px;
    padding: 1px 5px;
  }

  .delete-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    color: var(--vscode-errorForeground, #cc3333);
    font-size: 18px;
    line-height: 20px;
    text-align: center;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.1s;
    border-radius: 3px;
    padding: 0;
  }

  .delete-btn:hover {
    background: var(--vscode-inputValidation-errorBackground, rgba(200,0,0,0.1));
  }

  .broken-card {
    background: var(--vscode-inputValidation-warningBackground, rgba(200,140,0,0.08));
    border-color: var(--vscode-inputValidation-warningBorder, #8a6d00);
    color: var(--vscode-inputValidation-warningForeground, #8a6d00);
    font-size: 12px;
    font-style: italic;
    padding-right: 10px;
  }

  .empty-state {
    color: var(--vscode-descriptionForeground, rgba(128,128,128,0.8));
    font-style: italic;
    font-size: 12px;
    text-align: center;
    padding: 24px 0;
    user-select: none;
  }

  .drag-placeholder {
    height: 58px;
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.05));
    border: 2px dashed var(--vscode-focusBorder, #007acc);
    border-radius: 6px;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .add-card-btn {
    width: 100%;
    margin-top: 8px;
    padding: 7px;
    border: 1px dashed var(--vscode-widget-border, rgba(128,128,128,0.4));
    background: transparent;
    border-radius: 6px;
    color: var(--vscode-descriptionForeground, rgba(128,128,128,0.8));
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .add-card-btn:hover {
    background: var(--vscode-list-hoverBackground);
    color: var(--vscode-foreground);
    border-color: var(--vscode-focusBorder);
  }

  .card.editing {
    padding: 0;
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .card-editor {
    display: block;
    width: 100%;
    min-height: 80px;
    padding: 10px;
    background: var(--vscode-input-background, var(--vscode-editor-background));
    color: var(--vscode-input-foreground, var(--vscode-foreground));
    border: none;
    border-radius: 6px;
    font-family: var(--vscode-editor-font-family, 'Menlo', 'Monaco', monospace);
    font-size: 12px;
    line-height: 1.5;
    resize: none;
    outline: none;
    overflow: hidden;
  }

  .board-error {
    padding: 24px;
    color: var(--vscode-errorForeground, #cc3333);
  }
</style>
</head>
<body>
<div id="board"></div>
<script nonce="${nonce}">
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  let state = null;
  let editingCardId = null;

  // Drag state
  let draggedId = null;
  let draggedFromColumn = null;

  // ── Message handling ────────────────────────────────────────────────────────

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (msg.type === 'setState') {
      if (msg.error) {
        document.getElementById('board').innerHTML =
          '<div class="board-error">Error loading board: ' + escHtml(String(msg.error)) + '<br><br>Run <strong>Kanban: Init Board</strong> to create a new board.</div>';
        return;
      }
      clearTimeout(readyRetry);
      state = { manifest: msg.manifest, cards: msg.cards };
      if (editingCardId === null) {
        render();
      }
    }
  });

  vscode.postMessage({ type: 'ready' });

  // Re-send ready if state hasn't arrived within 500ms (handles rare message-drop cases)
  var readyRetry = setTimeout(function () {
    if (state === null) {
      vscode.postMessage({ type: 'ready' });
    }
  }, 500);

  // ── Rendering ───────────────────────────────────────────────────────────────

  function render() {
    const board = document.getElementById('board');
    if (!state || !state.manifest) {
      board.innerHTML = '<div class="board-error">Board not initialized. Run <strong>Kanban: Init Board</strong> first.</div>';
      return;
    }

    // Save scroll positions
    const boardScrollLeft = board.scrollLeft;
    const colScrolls = {};
    board.querySelectorAll('.column').forEach(function (col) {
      const cardsEl = col.querySelector('.cards');
      colScrolls[col.dataset.id] = cardsEl ? cardsEl.scrollTop : 0;
    });

    board.innerHTML = '';
    state.manifest.columns.forEach(function (col) {
      board.appendChild(renderColumn(col));
    });

    // Restore scroll positions
    board.scrollLeft = boardScrollLeft;
    board.querySelectorAll('.column').forEach(function (col) {
      const cardsEl = col.querySelector('.cards');
      if (cardsEl) cardsEl.scrollTop = colScrolls[col.dataset.id] || 0;
    });
  }

  function renderColumn(col) {
    const cardIds = state.manifest.cards[col.id] || [];

    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.id = col.id;

    // Header
    const header = document.createElement('div');
    header.className = 'column-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'column-title';
    titleSpan.textContent = col.label;

    const countSpan = document.createElement('span');
    countSpan.className = 'card-count';
    countSpan.textContent = String(cardIds.length);

    header.appendChild(titleSpan);
    header.appendChild(countSpan);
    colEl.appendChild(header);

    // Cards container
    const cardsEl = document.createElement('div');
    cardsEl.className = 'cards';

    if (cardIds.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No cards yet';
      cardsEl.appendChild(empty);
    } else {
      cardIds.forEach(function (id) {
        cardsEl.appendChild(renderCard(id, col.id));
      });
    }

    colEl.appendChild(cardsEl);

    // Add card button
    const addBtn = document.createElement('button');
    addBtn.className = 'add-card-btn';
    addBtn.textContent = '+ Add card';
    addBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'addCard', columnId: col.id });
    });
    colEl.appendChild(addBtn);

    setupDropZone(colEl, col.id, cardsEl);

    return colEl;
  }

  function renderCard(id, columnId) {
    const card = state.cards[id];

    // Broken card placeholder
    if (!card) {
      const div = document.createElement('div');
      div.className = 'card broken-card';
      div.dataset.id = id;
      div.dataset.column = columnId;
      div.textContent = '\u26a0 Missing card file: ' + id;
      return div;
    }

    // Edit mode
    if (editingCardId === id) {
      return renderCardEditMode(id, card, columnId);
    }

    const content = card.content || '';
    const title = extractTitle(content);
    const tags = extractTags(content);

    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.id = id;
    div.dataset.column = columnId;
    div.draggable = true;

    const titleDiv = document.createElement('div');
    titleDiv.className = 'card-title';
    titleDiv.textContent = title || '(untitled)';
    div.appendChild(titleDiv);

    if (tags.length > 0) {
      const tagsDiv = document.createElement('div');
      tagsDiv.className = 'card-tags';
      tags.forEach(function (tag) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = '#' + tag;
        tagsDiv.appendChild(chip);
      });
      div.appendChild(tagsDiv);
    }

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '\u00d7';
    delBtn.title = 'Delete card';
    delBtn.addEventListener('mousedown', function (e) {
      e.preventDefault(); // prevent textarea blur if nearby card is editing
    });
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (confirm('Delete this card?')) {
        vscode.postMessage({ type: 'deleteCard', id: id });
      }
    });
    div.appendChild(delBtn);

    // Double-click to enter edit mode
    div.addEventListener('dblclick', function (e) {
      if (e.target === delBtn) return;
      editingCardId = id;
      const editEl = renderCardEditMode(id, card, columnId);
      div.replaceWith(editEl);
      const ta = editEl.querySelector('textarea');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });

    setupDragSource(div, id, columnId);

    return div;
  }

  function renderCardEditMode(id, card, columnId) {
    const div = document.createElement('div');
    div.className = 'card editing';
    div.dataset.id = id;
    div.dataset.column = columnId;

    const ta = document.createElement('textarea');
    ta.className = 'card-editor';
    ta.value = card.content || '';
    ta.placeholder = 'Card content (markdown)\\nFirst line = title  \\u00b7  #tag for tags';

    function autoGrow() {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
    ta.addEventListener('input', autoGrow);

    let done = false;

    function save() {
      if (done) return;
      done = true;
      editingCardId = null;
      vscode.postMessage({ type: 'saveCard', id: id, content: ta.value });
      // Extension will respond with setState which triggers render()
    }

    function discard() {
      if (done) return;
      done = true;
      editingCardId = null;
      render();
    }

    ta.addEventListener('blur', save);

    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        ta.removeEventListener('blur', save);
        discard();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        ta.removeEventListener('blur', save);
        save();
      }
    });

    div.appendChild(ta);

    // Auto-grow after mount
    requestAnimationFrame(function () {
      autoGrow();
    });

    return div;
  }

  // ── Drag and drop ───────────────────────────────────────────────────────────

  function setupDragSource(el, id, columnId) {
    el.addEventListener('dragstart', function (e) {
      draggedId = id;
      draggedFromColumn = columnId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      // Defer so the ghost image captures the non-faded state
      setTimeout(function () { el.classList.add('dragging'); }, 0);
    });

    el.addEventListener('dragend', function () {
      el.classList.remove('dragging');
      draggedId = null;
      draggedFromColumn = null;
      removePlaceholder();
      document.querySelectorAll('.column.drag-over').forEach(function (c) {
        c.classList.remove('drag-over');
      });
    });
  }

  function setupDropZone(colEl, columnId, cardsEl) {
    var enterCount = 0;

    colEl.addEventListener('dragenter', function (e) {
      e.preventDefault();
      enterCount++;
      colEl.classList.add('drag-over');
    });

    colEl.addEventListener('dragleave', function () {
      enterCount--;
      if (enterCount <= 0) {
        enterCount = 0;
        colEl.classList.remove('drag-over');
      }
    });

    colEl.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const afterEl = getDragAfterElement(cardsEl, e.clientY);
      const ph = getPlaceholder();
      if (afterEl === null) {
        cardsEl.appendChild(ph);
      } else {
        cardsEl.insertBefore(ph, afterEl);
      }
    });

    colEl.addEventListener('drop', function (e) {
      e.preventDefault();
      enterCount = 0;
      colEl.classList.remove('drag-over');

      if (!draggedId) return;

      const ph = document.getElementById('kanban-drag-ph');
      let toIndex = 0;
      if (ph && ph.parentElement === cardsEl) {
        const siblings = Array.prototype.slice.call(cardsEl.children);
        const phIdx = siblings.indexOf(ph);
        toIndex = siblings.slice(0, phIdx).filter(function (el) {
          return el.classList.contains('card') && !el.classList.contains('dragging');
        }).length;
      }

      removePlaceholder();

      vscode.postMessage({
        type: 'moveCard',
        id: draggedId,
        fromColumn: draggedFromColumn,
        toColumn: columnId,
        toIndex: toIndex,
      });
    });
  }

  function getDragAfterElement(container, y) {
    const els = Array.prototype.slice.call(
      container.querySelectorAll('.card:not(.dragging):not(#kanban-drag-ph)')
    );
    const result = els.reduce(function (closest, child) {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      }
      return closest;
    }, { offset: -Infinity, element: null });
    return result.element;
  }

  function getPlaceholder() {
    let ph = document.getElementById('kanban-drag-ph');
    if (!ph) {
      ph = document.createElement('div');
      ph.id = 'kanban-drag-ph';
      ph.className = 'drag-placeholder';
    }
    return ph;
  }

  function removePlaceholder() {
    const ph = document.getElementById('kanban-drag-ph');
    if (ph && ph.parentElement) ph.parentElement.removeChild(ph);
  }

  // ── Utilities ───────────────────────────────────────────────────────────────

  function extractTitle(content) {
    const lines = content.split('\\n');
    const first = lines.find(function (l) { return l.trim() !== ''; }) || '';
    return first.replace(/^#+\\s*/, '').trim();
  }

  function extractTags(content) {
    const matches = content.match(/#(\\w+)/g) || [];
    const seen = {};
    return matches.map(function (t) { return t.slice(1); }).filter(function (t) {
      if (seen[t]) return false;
      seen[t] = true;
      return true;
    });
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

}());
</script>
</body>
</html>`;
  }
}

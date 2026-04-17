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
      if (msg.editCardId) {
        editingCardId = msg.editCardId;
        render();
        var ta = document.querySelector('.card.editing textarea');
        if (ta) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      } else if (editingCardId === null) {
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
    const cardIds = col.cards || [];

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
    const wipExceeded = col.wip_limit !== null && col.wip_limit !== undefined && cardIds.length > col.wip_limit;
    countSpan.className = 'card-count' + (wipExceeded ? ' card-count--exceeded' : '');
    countSpan.textContent = col.wip_limit !== null && col.wip_limit !== undefined
      ? cardIds.length + '/' + col.wip_limit
      : String(cardIds.length);

    header.appendChild(titleSpan);
    header.appendChild(countSpan);
    colEl.appendChild(header);

    // Archive all button for done column
    if (col.id === 'done' && cardIds.length > 0) {
      const archiveBtn = document.createElement('button');
      archiveBtn.className = 'archive-done-btn';
      archiveBtn.textContent = '\u{1F5C3} Archive all';
      archiveBtn.title = 'Move all done cards to archive';
      archiveBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'archiveDone' });
      });
      colEl.appendChild(archiveBtn);
    }

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
    const body = extractBody(content);

    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.id = id;
    div.dataset.column = columnId;
    div.draggable = true;

    const idRow = document.createElement('div');
    idRow.className = 'card-id-row';
    const idDiv = document.createElement('span');
    idDiv.className = 'card-id';
    idDiv.textContent = id;
    idRow.appendChild(idDiv);
    if (state.manifest.showCardAge !== false && card.metadata && card.metadata.created_at && card.metadata.done_at) {
      const ltSpan = document.createElement('span');
      ltSpan.className = 'card-lead-time';
      ltSpan.title = 'Lead time: creation to done';
      ltSpan.textContent = formatDuration(card.metadata.created_at, card.metadata.done_at);
      idRow.appendChild(ltSpan);
    }
    div.appendChild(idRow);

    const titleDiv = document.createElement('div');
    titleDiv.className = 'card-title';
    titleDiv.textContent = title || '(untitled)';
    div.appendChild(titleDiv);

    if (body) {
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'card-body';
      bodyDiv.textContent = body;
      div.appendChild(bodyDiv);
    }

    const colorTarget = (state.manifest.tagColorTarget) || 'tag';

    // For card-border / card-background: find dominant tag (highest weight)
    if (colorTarget !== 'tag' && tags.length > 0) {
      var dominantColor = null;
      var bestWeight = -Infinity;
      tags.forEach(function (tag) {
        const tagDef = state.manifest.tags && state.manifest.tags[tag];
        if (tagDef && tagDef.color) {
          const w = typeof tagDef.weight === 'number' ? tagDef.weight : 0;
          if (w > bestWeight) {
            bestWeight = w;
            dominantColor = tagDef.color;
          }
        }
      });
      if (dominantColor) {
        if (colorTarget === 'card-border') {
          div.style.borderLeftWidth = '4px';
          div.style.borderLeftColor = dominantColor;
          div.style.paddingLeft = '8px';
        } else if (colorTarget === 'card-background') {
          div.style.backgroundColor = dominantColor + '22';
        }
      }
    }

    if (tags.length > 0) {
      const tagsDiv = document.createElement('div');
      tagsDiv.className = 'card-tags';
      tags.forEach(function (tag) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = '#' + tag;
        if (colorTarget === 'tag') {
          const tagDef = state.manifest.tags && state.manifest.tags[tag];
          if (tagDef && tagDef.color) {
            chip.style.backgroundColor = tagDef.color;
            chip.style.color = '#fff';
          }
        }
        tagsDiv.appendChild(chip);
      });
      div.appendChild(tagsDiv);
    }

    // Menu button (⋮)
    const menuBtn = document.createElement('button');
    menuBtn.className = 'card-menu-btn';
    menuBtn.textContent = '\u22ee';
    menuBtn.title = 'Card actions';
    menuBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      showCardContextMenu(rect.right, rect.bottom, id, div, columnId);
    });
    div.appendChild(menuBtn);

    // Double-click to enter edit mode
    div.addEventListener('dblclick', function (e) {
      if (e.target === menuBtn) return;
      editingCardId = id;
      const editEl = renderCardEditMode(id, card, columnId);
      div.replaceWith(editEl);
      const ta = editEl.querySelector('textarea');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });

    // Right-click context menu
    div.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showCardContextMenu(e.clientX, e.clientY, id, div, columnId);
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
    ta.placeholder = 'Card content (markdown)\nFirst line = title  \u00b7  #tag for tags';

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

  // ── Context menu ────────────────────────────────────────────────────────────

  function closeContextMenu() {
    const existing = document.getElementById('kanban-context-menu');
    if (existing) existing.remove();
  }

  function showCardContextMenu(x, y, id, cardEl, columnId) {
    closeContextMenu();

    const menu = document.createElement('div');
    menu.id = 'kanban-context-menu';
    menu.className = 'context-menu';

    function menuItem(icon, label, action, destructive) {
      const item = document.createElement('button');
      item.className = 'context-menu-item' + (destructive ? ' context-menu-item--danger' : '');
      const iconSpan = document.createElement('span');
      iconSpan.className = 'context-menu-icon';
      iconSpan.textContent = icon;
      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      item.appendChild(iconSpan);
      item.appendChild(labelSpan);
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        closeContextMenu();
        action();
      });
      return item;
    }

    function divider() {
      const d = document.createElement('div');
      d.className = 'context-menu-divider';
      return d;
    }

    // View content
    menu.appendChild(menuItem('◧', 'View content', function () {
      const card = state.cards[id];
      const content = (card && card.content) || '';
      showContentPopup(id, content);
    }));

    // Metadata
    menu.appendChild(menuItem('ℹ', 'Metadata', function () {
      const existing = cardEl.querySelector('.card-metadata-popup');
      if (existing) { existing.remove(); return; }

      const meta = (state.cards[id] && state.cards[id].metadata) || {};
      const popup = document.createElement('div');
      popup.className = 'card-metadata-popup';

      function addRow(label, value) {
        const div = document.createElement('div');
        const lbl = document.createElement('span');
        lbl.className = 'meta-label';
        lbl.textContent = label;
        div.appendChild(lbl);
        div.appendChild(document.createTextNode(
          value !== undefined && value !== null && value !== '' ? String(value) : '\u2014'
        ));
        popup.appendChild(div);
      }

      function fmtDate(val) {
        if (!val) return null;
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d.toLocaleString();
      }

      // Priority fields: always shown in this order, with optional formatting.
      // Date fields are formatted as locale strings; others shown as-is.
      // Fields that are absent or empty are skipped.
      var PRIORITY = [
        ['created_at',  'created:',  fmtDate],
        ['column',      'column:',   null],
        ['order',       'order:',    null],
        ['active_at',   'active:',   fmtDate],
        ['done_at',     'done:',     fmtDate],
        ['branch',      'branch:',   null],
        ['archived_at', 'archived:', fmtDate],
      ];
      var PRIORITY_KEYS = {};
      PRIORITY.forEach(function (p) { PRIORITY_KEYS[p[0]] = true; });

      // id is always first (it lives on the card, not in metadata)
      addRow('id:', id);

      for (var i = 0; i < PRIORITY.length; i++) {
        var key = PRIORITY[i][0], label = PRIORITY[i][1], fmt = PRIORITY[i][2];
        var raw = meta[key];
        if (raw !== undefined && raw !== null && raw !== '') {
          addRow(label, fmt ? (fmtDate(raw) || raw) : raw);
        }
      }

      // Computed fields (derived, not stored in metadata)
      if (meta.done_at) {
        addRow('lead time:', formatDuration(meta.created_at, meta.done_at));
      }
      if (meta.active_at && meta.done_at) {
        addRow('cycle time:', formatDuration(meta.active_at, meta.done_at));
      }

      // All remaining metadata fields not in the priority list, in natural order.
      // Any field added to a card now or in the future will appear here automatically.
      Object.keys(meta).forEach(function (key) {
        if (!PRIORITY_KEYS[key] && meta[key] !== undefined && meta[key] !== null && meta[key] !== '') {
          addRow(key + ':', String(meta[key]));
        }
      });

      cardEl.appendChild(popup);
      setTimeout(function () {
        document.addEventListener('click', function closePopup(ev) {
          if (!popup.contains(ev.target)) {
            popup.remove();
            document.removeEventListener('click', closePopup);
          }
        });
      }, 0);
    }));

    // Copy ID
    menu.appendChild(menuItem('⎘', 'Copy ID', function () {
      navigator.clipboard.writeText(id);
    }));

    // Open file in editor
    menu.appendChild(menuItem('↗', 'Open file', function () {
      vscode.postMessage({ type: 'openCardFile', id: id });
    }));

    menu.appendChild(divider());

    // Delete
    menu.appendChild(menuItem('✕', 'Delete', function () {
      showDeleteConfirm(id, cardEl);
    }, true));

    document.body.appendChild(menu);

    // Position — keep within viewport
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const mw = menu.offsetWidth || 160;
    const mh = menu.offsetHeight || 140;
    menu.style.left = (x + mw > vw ? vw - mw - 4 : x) + 'px';
    menu.style.top  = (y + mh > vh ? vh - mh - 4 : y) + 'px';

    setTimeout(function () {
      document.addEventListener('click', closeContextMenu, { once: true });
      document.addEventListener('contextmenu', closeContextMenu, { once: true });
    }, 0);
  }

  function showContentPopup(id, content) {
    const existing = document.getElementById('kanban-content-modal');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'kanban-content-modal';
    overlay.className = 'content-modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'content-modal';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'content-modal-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.title = 'Close (Esc)';
    closeBtn.addEventListener('click', close);
    dialog.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'content-modal-body';
    body.innerHTML = renderMarkdown(content);
    dialog.appendChild(body);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
  }

  function showDeleteConfirm(id, cardEl) {
    const existing = cardEl.querySelector('.delete-confirm');
    if (existing) { existing.remove(); return; }
    const confirmBar = document.createElement('div');
    confirmBar.className = 'delete-confirm';
    const yesBtn = document.createElement('button');
    yesBtn.className = 'delete-confirm-yes';
    yesBtn.textContent = 'Delete?';
    const noBtn = document.createElement('button');
    noBtn.className = 'delete-confirm-no';
    noBtn.textContent = '\u00d7';
    confirmBar.appendChild(yesBtn);
    confirmBar.appendChild(noBtn);
    cardEl.appendChild(confirmBar);
    function dismiss() { confirmBar.remove(); }
    yesBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      vscode.postMessage({ type: 'deleteCard', id: id });
    });
    noBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      dismiss();
    });
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
    const lines = content.split('\n');
    const line = lines.find(function (l) { return /^#\s+/.test(l); }) || '';
    return line.replace(/^#+\s*/, '').trim();
  }

  function extractBody(content) {
    const lines = content.split('\n');
    return lines.filter(function (l) {
      return !/^#\w+/.test(l) && !/^#\s+/.test(l);
    }).join('\n').trim();
  }

  function extractTags(content) {
    const matches = content.match(/#(\w+)/g) || [];
    const seen = {};
    return matches.map(function (t) { return t.slice(1); }).filter(function (t) {
      if (seen[t]) return false;
      seen[t] = true;
      return true;
    });
  }

  function formatDuration(fromAt, toAt) {
    const ms = new Date(toAt).getTime() - new Date(fromAt).getTime();
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return (minutes < 1 ? 0 : minutes) + 'm';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + 'd';
    return Math.floor(days / 7) + 'w';
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inlineMd(text) {
    // Escape HTML first so user text can't inject tags
    text = escHtml(text);
    // Extract inline code to protect it from further replacements
    var codes = [];
    text = text.replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c);
      return '\x00IC' + (codes.length - 1) + '\x00';
    });
    // Bold + italic
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/_(.+?)_/g, '<em>$1</em>');
    // Strikethrough
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
    // Links — show label only (no real href in webview)
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '<span class="md-link">$1</span>');
    // Restore inline code
    text = text.replace(/\x00IC(\d+)\x00/g, function (_, i) {
      return '<code class="md-code">' + codes[+i] + '</code>';
    });
    return text;
  }

  function renderMarkdown(md) {
    if (!md) return '<em class="md-empty">(empty)</em>';

    // 1. Extract fenced code blocks first
    var codeBlocks = [];
    var src = md.replace(/```([^\n]*)\n([\s\S]*?)```/g, function (_, lang, code) {
      codeBlocks.push('<pre class="md-pre"><code>' + escHtml(code) + '</code></pre>');
      return '\x00CB' + (codeBlocks.length - 1) + '\x00';
    });

    // 2. Process line by line
    var lines = src.split('\n');
    var out = [];
    var listType = null;

    function closeList() {
      if (listType === 'ul') { out.push('</ul>'); }
      if (listType === 'ol') { out.push('</ol>'); }
      listType = null;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Code block placeholder — pass through as-is
      if (/^\x00CB\d+\x00$/.test(line.trim())) {
        closeList();
        out.push(line.trim());
        continue;
      }

      // Heading
      var hm = line.match(/^(#{1,6})\s+(.*)/);
      if (hm) {
        closeList();
        var lvl = hm[1].length;
        out.push('<h' + lvl + ' class="md-h">' + inlineMd(hm[2]) + '</h' + lvl + '>');
        continue;
      }

      // Horizontal rule
      if (/^([-*_])\1{2,}\s*$/.test(line)) {
        closeList();
        out.push('<hr class="md-hr">');
        continue;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        closeList();
        out.push('<blockquote class="md-bq">' + inlineMd(line.slice(2)) + '</blockquote>');
        continue;
      }

      // Unordered list
      var ulm = line.match(/^[-*+]\s+(.*)/);
      if (ulm) {
        if (listType !== 'ul') { closeList(); out.push('<ul class="md-ul">'); listType = 'ul'; }
        out.push('<li>' + inlineMd(ulm[1]) + '</li>');
        continue;
      }

      // Ordered list
      var olm = line.match(/^\d+[.)]\s+(.*)/);
      if (olm) {
        if (listType !== 'ol') { closeList(); out.push('<ol class="md-ol">'); listType = 'ol'; }
        out.push('<li>' + inlineMd(olm[1]) + '</li>');
        continue;
      }

      // Blank line
      if (!line.trim()) {
        closeList();
        continue;
      }

      // Paragraph
      closeList();
      out.push('<p class="md-p">' + inlineMd(line) + '</p>');
    }

    closeList();

    // 3. Restore code blocks
    var html = out.join('');
    codeBlocks.forEach(function (block, idx) {
      html = html.replace('\x00CB' + idx + '\x00', block);
    });
    return html;
  }

}());

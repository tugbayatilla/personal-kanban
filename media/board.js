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
    const first = lines.find(function (l) { return l.trim() !== ''; }) || '';
    return first.replace(/^#+\s*/, '').trim();
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

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

}());

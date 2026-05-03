// adapter.js — bridges board.js (postMessage protocol) to fetch() REST API
// Loaded before board.js so window.vscode is available immediately
(function () {
  'use strict';

  function dispatchState(state) {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'setState',
          manifest: state.manifest,
          cards: state.cards,
        },
      })
    );
  }

  async function fetchState() {
    const res = await fetch('/api/board');
    if (!res.ok) throw new Error('Failed to fetch board state');
    return res.json();
  }

  async function refreshBoard() {
    try {
      const state = await fetchState();
      dispatchState(state);
    } catch (e) {
      console.error('kanban: failed to refresh board', e);
    }
  }

  window.vscode = {
    postMessage: async function (msg) {
      try {
        switch (msg.type) {
          case 'ready':
            await refreshBoard();
            break;

          case 'addCard':
            await fetch('/api/cards', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ columnId: msg.columnId, title: '' }),
            });
            await refreshBoard();
            break;

          case 'saveCard':
            await fetch('/api/cards/' + msg.id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: msg.content }),
            });
            await refreshBoard();
            break;

          case 'deleteCard':
            await fetch('/api/cards/' + msg.id, { method: 'DELETE' });
            await refreshBoard();
            break;

          case 'moveCard': {
            const res = await fetch('/api/cards/' + msg.id + '/move', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                toColumn: msg.toColumn,
                fromColumn: msg.fromColumn,
                toIndex: msg.toIndex,
              }),
            });
            if (!res.ok) {
              const err = await res.json();
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    type: 'policyViolation',
                    message: err.error || 'Policy blocked this move.',
                  },
                })
              );
            }
            await refreshBoard();
            break;
          }

          case 'archiveDone':
            await fetch('/api/archive', { method: 'POST' });
            await refreshBoard();
            break;

          case 'openCardFile':
          case 'openManifestFile':
            // No-op in web context — these open files in VS Code
            break;

          default:
            console.warn('kanban adapter: unhandled message type', msg.type);
        }
      } catch (e) {
        console.error('kanban adapter error:', e);
      }
    },
  };

  // Poll every 3 seconds to pick up external file changes
  setInterval(refreshBoard, 3000);
})();

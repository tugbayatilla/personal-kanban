/**
 * Integration tests for BoardPanel message handlers — src/BoardPanel.ts
 *
 * Strategy: the BoardPanel constructor requires a VSCode WebviewPanel. Rather
 * than instantiating the panel class directly (which drags in the full webview
 * lifecycle), we call the extracted pure-logic helpers through the actual
 * message handler by using a minimal fake panel object. Card file I/O is done
 * against a real temporary directory so serialization bugs are caught.
 *
 * The `_handleMessage` method is private. We access it via a type cast. If the
 * method is ever renamed the TypeScript compiler will surface the break.
 *
 * Directory layout used in every test:
 *   workspaceRoot   = tmpdir                  (passed to BoardPanel constructor)
 *   boardFolderName = 'board'                 (set in mock config)
 *   boardRoot       = tmpdir/board            (where manifest.json + cards/ live)
 *
 * getBoardRoot() returns path.join(workspaceRoot, boardFolderName), so the
 * panel writes files into boardRoot without any path.join('.') ambiguity.
 *
 * Coverage:
 *   - addCard:      file created with correct column and order; order = midpoint(last, 1)
 *   - moveCard:     only moved card's column and order change; active_at stamped when
 *                   moving to in-progress; done_at stamped when moving to done;
 *                   no other cards are modified
 *   - deleteCard:   card file deleted; column read from card metadata not manifest
 *   - archiveDone:  done cards get archived_at; moved to archive/; manifest not written
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetMockConfig, setMockConfig } from './__mocks__/vscode';
import { readCard, writeCard } from '../io';
import { initLogger } from '../hooks';
import { Card, WebviewMessage } from '../types';

// ── Constants ─────────────────────────────────────────────────────────────────

const BOARD_FOLDER_NAME = 'board';

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pk-board-test-'));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Returns the boardRoot (workspaceRoot/board) for a given workspaceRoot. */
function toBoardRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, BOARD_FOLDER_NAME);
}

function writeMinimalManifest(boardRoot: string, wipLimit: number | null = null): void {
  const manifest = {
    version: 1,
    name: 'Test Board',
    columns: [
      { id: 'backlog',      label: 'Backlog',      index: 0, wip_limit: null,     policies: {} },
      { id: 'in-progress',  label: 'In Progress',  index: 1, wip_limit: wipLimit, policies: {} },
      { id: 'done',         label: 'Done',          index: 2, wip_limit: null,     policies: {} },
    ],
    scripts: {},
    hooks: {},
  };
  fs.mkdirSync(boardRoot, { recursive: true });
  fs.writeFileSync(path.join(boardRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function makeCard(id: string, overrides: Partial<Card['metadata']> = {}): Card {
  return {
    id,
    content: `# Task ${id}`,
    metadata: {
      created_at: '2024-01-15T10:00:00.000Z',
      column: 'backlog',
      order: '0.5',
      ...overrides,
    },
  };
}

/**
 * Construct a BoardPanel instance and invoke its private `_handleMessage`.
 *
 * `workspaceRoot` is the temp directory. The panel resolves boardRoot via
 * getBoardRoot(workspaceRoot), which returns path.join(workspaceRoot, boardFolderName).
 * boardFolderName is set to BOARD_FOLDER_NAME in the mock config before each test.
 */
async function callHandler(
  workspaceRoot: string,
  msg: WebviewMessage
): Promise<void> {
  // Lazy-require so the test module resolution uses the active mock registry.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BoardPanel } = require('../BoardPanel') as typeof import('../BoardPanel');

  const fakeWebviewPanel = {
    webview: {
      html: '',
      onDidReceiveMessage: jest.fn(),
      postMessage: jest.fn(),
      asWebviewUri: (uri: { fsPath: string }) => uri,
      cspSource: 'vscode-resource:',
    },
    onDidDispose: jest.fn(),
    onDidChangeViewState: jest.fn(),
    reveal: jest.fn(),
    dispose: jest.fn(),
  };

  const fakeExtensionUri = { fsPath: '/fake/extension' };

  const PanelClass = BoardPanel as unknown as {
    new (
      panel: typeof fakeWebviewPanel,
      workspaceRoot: string,
      extensionUri: typeof fakeExtensionUri
    ): { _handleMessage(msg: WebviewMessage): Promise<void> };
  };

  const instance = new PanelClass(fakeWebviewPanel as never, workspaceRoot, fakeExtensionUri as never);
  await instance._handleMessage(msg);
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('BoardPanel message handler', () => {
  let workspaceRoot: string;
  let boardRoot: string;

  beforeEach(() => {
    workspaceRoot = makeTempDir();
    boardRoot = toBoardRoot(workspaceRoot);

    resetMockConfig();
    setMockConfig({ boardFolderName: BOARD_FOLDER_NAME, enableHooks: false });

    writeMinimalManifest(boardRoot);
    fs.mkdirSync(path.join(boardRoot, 'cards'), { recursive: true });

    initLogger({ appendLine: () => {}, show: () => {}, dispose: () => {} } as never);
  });

  afterEach(() => {
    removeTempDir(workspaceRoot);
    // Reset static currentPanel reference so tests are isolated.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { BoardPanel } = require('../BoardPanel') as typeof import('../BoardPanel');
      (BoardPanel as { currentPanel: unknown }).currentPanel = undefined;
    } catch {
      // module may have been cleared
    }
  });

  // ── addCard ────────────────────────────────────────────────────────────────

  describe('addCard', () => {
    /**
     * @spec PANEL-001
     * @contract addCard must create a card file in cards/ with the correct
     *   column field set to the requested columnId. The manifest must not be
     *   written as part of this operation.
     */
    it('creates a card file in the cards directory', async () => {
      await callHandler(workspaceRoot, { type: 'addCard', columnId: 'backlog' });

      const files = fs.readdirSync(path.join(boardRoot, 'cards')).filter((f) => f.endsWith('.md'));
      expect(files).toHaveLength(1);
    });

    it('writes the requested columnId into the new card metadata', async () => {
      await callHandler(workspaceRoot, { type: 'addCard', columnId: 'in-progress' });

      const files = fs.readdirSync(path.join(boardRoot, 'cards')).filter((f) => f.endsWith('.md'));
      const id = files[0].replace('.md', '');
      const card = readCard(boardRoot, id);

      expect(card!.metadata.column).toBe('in-progress');
    });

    it('places the first card in an empty column at order 0.5 (midpoint of 0 and 1)', async () => {
      await callHandler(workspaceRoot, { type: 'addCard', columnId: 'backlog' });

      const files = fs.readdirSync(path.join(boardRoot, 'cards')).filter((f) => f.endsWith('.md'));
      const card = readCard(boardRoot, files[0].replace('.md', ''));

      expect(parseFloat(card!.metadata.order!)).toBe(0.5);
    });

    it('places a second card at the midpoint of the last card order and 1', async () => {
      writeCard(boardRoot, makeCard('existing', { column: 'backlog', order: '0.5' }));

      await callHandler(workspaceRoot, { type: 'addCard', columnId: 'backlog' });

      const files = fs.readdirSync(path.join(boardRoot, 'cards'))
        .filter((f) => f.endsWith('.md') && !f.startsWith('existing'));
      const newCard = readCard(boardRoot, files[0].replace('.md', ''));

      // (0.5 + 1) / 2 = 0.75
      expect(parseFloat(newCard!.metadata.order!)).toBe(0.75);
    });

    it('does not modify the manifest.json file', async () => {
      const before = fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8');

      await callHandler(workspaceRoot, { type: 'addCard', columnId: 'backlog' });

      const after = fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8');
      expect(after).toBe(before);
    });
  });

  // ── moveCard ───────────────────────────────────────────────────────────────

  describe('moveCard', () => {
    /**
     * @spec PANEL-002
     * @contract moveCard must update only the moved card's column and order fields.
     *   No other card files must be modified. The manifest must not be written.
     */
    it('updates the moved card column to the destination column', async () => {
      writeCard(boardRoot, makeCard('card-1', { column: 'backlog', order: '0.5' }));

      await callHandler(workspaceRoot, {
        type: 'moveCard',
        id: 'card-1',
        fromColumn: 'backlog',
        toColumn: 'in-progress',
        toIndex: 0,
      });

      const updated = readCard(boardRoot, 'card-1');
      expect(updated!.metadata.column).toBe('in-progress');
    });

    it('updates the moved card order to the midpoint of its new position', async () => {
      writeCard(boardRoot, makeCard('card-1', { column: 'backlog', order: '0.5' }));
      // in-progress is empty; inserting at index 0 → midpoint(0, 1) = 0.5
      await callHandler(workspaceRoot, {
        type: 'moveCard',
        id: 'card-1',
        fromColumn: 'backlog',
        toColumn: 'in-progress',
        toIndex: 0,
      });

      const updated = readCard(boardRoot, 'card-1');
      expect(parseFloat(updated!.metadata.order!)).toBe(0.5);
    });

    it('does not modify sibling cards in the source column', async () => {
      writeCard(boardRoot, makeCard('card-1', { column: 'backlog', order: '0.25' }));
      writeCard(boardRoot, makeCard('card-2', { column: 'backlog', order: '0.5'  }));

      const card2MtimeBefore = fs.statSync(path.join(boardRoot, 'cards', 'card-2.md')).mtimeMs;

      await callHandler(workspaceRoot, {
        type: 'moveCard',
        id: 'card-1',
        fromColumn: 'backlog',
        toColumn: 'in-progress',
        toIndex: 0,
      });

      const card2MtimeAfter = fs.statSync(path.join(boardRoot, 'cards', 'card-2.md')).mtimeMs;
      expect(card2MtimeAfter).toBe(card2MtimeBefore);
    });

    /**
     * @spec PANEL-003
     * @contract Moving a card to the in-progress column for the first time must
     *   stamp active_at. Subsequent moves back into in-progress must NOT overwrite it.
     */
    it('stamps active_at on first move to the in-progress column', async () => {
      writeCard(boardRoot, makeCard('card-1', { column: 'backlog', order: '0.5', active_at: undefined }));

      await callHandler(workspaceRoot, {
        type: 'moveCard',
        id: 'card-1',
        fromColumn: 'backlog',
        toColumn: 'in-progress',
        toIndex: 0,
      });

      const updated = readCard(boardRoot, 'card-1');
      expect(updated!.metadata.active_at).toBeDefined();
      expect(updated!.metadata.active_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('does not overwrite an existing active_at when moving back to in-progress', async () => {
      const originalActiveAt = '2024-01-10T08:00:00.000Z';
      writeCard(boardRoot, makeCard('card-1', {
        column: 'backlog',
        order: '0.5',
        active_at: originalActiveAt,
      }));

      await callHandler(workspaceRoot, {
        type: 'moveCard',
        id: 'card-1',
        fromColumn: 'backlog',
        toColumn: 'in-progress',
        toIndex: 0,
      });

      const updated = readCard(boardRoot, 'card-1');
      expect(updated!.metadata.active_at).toBe(originalActiveAt);
    });

    /**
     * @spec PANEL-004
     * @contract Moving a card to the done column must always stamp done_at.
     */
    it('stamps done_at when moving to the done column', async () => {
      writeCard(boardRoot, makeCard('card-1', { column: 'in-progress', order: '0.5' }));

      await callHandler(workspaceRoot, {
        type: 'moveCard',
        id: 'card-1',
        fromColumn: 'in-progress',
        toColumn: 'done',
        toIndex: 0,
      });

      const updated = readCard(boardRoot, 'card-1');
      expect(updated!.metadata.done_at).toBeDefined();
      expect(updated!.metadata.done_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('does not stamp active_at when moving to a column other than in-progress', async () => {
      writeCard(boardRoot, makeCard('card-1', {
        column: 'backlog',
        order: '0.5',
        active_at: undefined,
      }));

      await callHandler(workspaceRoot, {
        type: 'moveCard',
        id: 'card-1',
        fromColumn: 'backlog',
        toColumn: 'done',
        toIndex: 0,
      });

      const updated = readCard(boardRoot, 'card-1');
      expect(updated!.metadata.active_at).toBeUndefined();
    });

    it('does not write the manifest file when moving a card', async () => {
      writeCard(boardRoot, makeCard('card-1', { column: 'backlog', order: '0.5' }));
      const before = fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8');

      await callHandler(workspaceRoot, {
        type: 'moveCard',
        id: 'card-1',
        fromColumn: 'backlog',
        toColumn: 'in-progress',
        toIndex: 0,
      });

      const after = fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8');
      expect(after).toBe(before);
    });
  });

  // ── deleteCard ─────────────────────────────────────────────────────────────

  describe('deleteCard', () => {
    /**
     * @spec PANEL-005
     * @contract deleteCard must delete the card .md file from the cards/
     *   directory. The column to delete from is read from the card metadata —
     *   not from the manifest.
     */
    it('removes the card file from the cards directory', async () => {
      writeCard(boardRoot, makeCard('card-to-delete', { column: 'backlog', order: '0.5' }));

      await callHandler(workspaceRoot, { type: 'deleteCard', id: 'card-to-delete' });

      expect(fs.existsSync(path.join(boardRoot, 'cards', 'card-to-delete.md'))).toBe(false);
    });

    it('does not remove other card files when deleting one card', async () => {
      writeCard(boardRoot, makeCard('target',    { column: 'backlog', order: '0.25' }));
      writeCard(boardRoot, makeCard('bystander', { column: 'backlog', order: '0.5'  }));

      await callHandler(workspaceRoot, { type: 'deleteCard', id: 'target' });

      expect(fs.existsSync(path.join(boardRoot, 'cards', 'bystander.md'))).toBe(true);
    });

    it('does not throw when asked to delete a card that does not exist', async () => {
      await expect(
        callHandler(workspaceRoot, { type: 'deleteCard', id: 'ghost-card' })
      ).resolves.not.toThrow();
    });

    it('does not write the manifest file when deleting a card', async () => {
      writeCard(boardRoot, makeCard('card-del', { column: 'backlog', order: '0.5' }));
      const before = fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8');

      await callHandler(workspaceRoot, { type: 'deleteCard', id: 'card-del' });

      const after = fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8');
      expect(after).toBe(before);
    });
  });

  // ── archiveDone ────────────────────────────────────────────────────────────

  describe('archiveDone', () => {
    /**
     * @spec PANEL-006
     * @contract archiveDone must move all cards in the done column to archive/
     *   and stamp archived_at on each. The manifest must not be written.
     */
    it('moves done cards to the archive directory', async () => {
      writeCard(boardRoot, makeCard('done-1', { column: 'done', order: '0.5'  }));
      writeCard(boardRoot, makeCard('done-2', { column: 'done', order: '0.75' }));

      await callHandler(workspaceRoot, { type: 'archiveDone' });

      expect(fs.existsSync(path.join(boardRoot, 'archive', 'done-1.md'))).toBe(true);
      expect(fs.existsSync(path.join(boardRoot, 'archive', 'done-2.md'))).toBe(true);
    });

    it('removes done card files from the cards directory after archiving', async () => {
      writeCard(boardRoot, makeCard('done-card', { column: 'done', order: '0.5' }));

      await callHandler(workspaceRoot, { type: 'archiveDone' });

      expect(fs.existsSync(path.join(boardRoot, 'cards', 'done-card.md'))).toBe(false);
    });

    it('stamps archived_at on each archived card', async () => {
      writeCard(boardRoot, makeCard('done-arch', { column: 'done', order: '0.5' }));

      await callHandler(workspaceRoot, { type: 'archiveDone' });

      const archived = readCard(boardRoot, 'done-arch');
      expect(archived!.metadata.archived_at).toBeDefined();
      expect(archived!.metadata.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('does not archive cards that are not in the done column', async () => {
      writeCard(boardRoot, makeCard('active-card', { column: 'in-progress', order: '0.5' }));

      await callHandler(workspaceRoot, { type: 'archiveDone' });

      expect(fs.existsSync(path.join(boardRoot, 'cards', 'active-card.md'))).toBe(true);
      expect(fs.existsSync(path.join(boardRoot, 'archive', 'active-card.md'))).toBe(false);
    });

    it('does not write the manifest file when archiving done cards', async () => {
      writeCard(boardRoot, makeCard('done-m', { column: 'done', order: '0.5' }));
      const before = fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8');

      await callHandler(workspaceRoot, { type: 'archiveDone' });

      const after = fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8');
      expect(after).toBe(before);
    });

    it('does nothing when the done column is empty', async () => {
      writeCard(boardRoot, makeCard('active', { column: 'backlog', order: '0.5' }));

      await expect(
        callHandler(workspaceRoot, { type: 'archiveDone' })
      ).resolves.not.toThrow();

      const archiveDir = path.join(boardRoot, 'archive');
      const archiveFiles = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir) : [];
      expect(archiveFiles).toHaveLength(0);
    });
  });
});

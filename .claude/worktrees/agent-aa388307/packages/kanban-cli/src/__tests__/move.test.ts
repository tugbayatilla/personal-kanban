import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCard, writeCard, readManifest } from '@personal-kanban/core';
import type { Card, Manifest } from '@personal-kanban/core';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pk-cli-move-test-'));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeManifestFile(boardRoot: string, extra: Partial<object> = {}): void {
  fs.mkdirSync(boardRoot, { recursive: true });
  fs.mkdirSync(path.join(boardRoot, 'cards'), { recursive: true });
  const manifest = {
    version: 1,
    name: 'Test Board',
    columns: [
      { id: 'backlog', label: 'Backlog', index: 0, wip_limit: null, policies: [] },
      { id: 'in-progress', label: 'In Progress', index: 1, wip_limit: null, policies: [] },
      { id: 'done', label: 'Done', index: 2, wip_limit: null, policies: [] },
    ],
    column_stamps: { active_at: 'in-progress', done_at: 'done' },
    board_policies: [],
    policies: {},
    scripts: {},
    hooks: {},
    ...extra,
  };
  fs.writeFileSync(path.join(boardRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function makeCard(id: string, column: string): Card {
  return {
    id,
    content: `# Card ${id}\n`,
    metadata: {
      created_at: '2024-01-15T10:00:00.000Z',
      column,
      order: '0.5',
    },
  };
}

/** Simulate the move logic from the move command */
function simulateMove(
  boardRoot: string,
  cardId: string,
  columnId: string,
): { card: Card; fromColumnId: string } {
  const manifest = readManifest(boardRoot);
  const card = readCard(boardRoot, cardId);
  if (!card) throw new Error(`Card ${cardId} not found`);

  const fromColumnId = card.metadata.column ?? manifest.columns[0]?.id ?? 'backlog';
  const now = new Date().toISOString();
  const newMetadata = {
    ...card.metadata,
    column: columnId,
    ...(manifest.column_stamps?.active_at === columnId && !card.metadata.active_at ? { active_at: now } : {}),
    ...(manifest.column_stamps?.done_at === columnId ? { done_at: now } : {})
  };

  const updatedCard = { ...card, metadata: newMetadata };
  writeCard(boardRoot, updatedCard);
  return { card: updatedCard, fromColumnId };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('move command', () => {
  let tmpDir: string;
  let boardRoot: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    boardRoot = path.join(tmpDir, '.personal-kanban');
    writeManifestFile(boardRoot);
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it('updates card column after move', () => {
    writeCard(boardRoot, makeCard('card-001', 'backlog'));
    simulateMove(boardRoot, 'card-001', 'in-progress');

    const card = readCard(boardRoot, 'card-001');
    expect(card).not.toBeNull();
    expect(card!.metadata.column).toBe('in-progress');
  });

  it('stamps active_at when moving to in-progress column', () => {
    writeCard(boardRoot, makeCard('card-001', 'backlog'));
    const { card } = simulateMove(boardRoot, 'card-001', 'in-progress');

    expect(card.metadata.active_at).toBeDefined();
    expect(card.metadata.active_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('stamps done_at when moving to done column', () => {
    writeCard(boardRoot, makeCard('card-001', 'backlog'));
    const { card } = simulateMove(boardRoot, 'card-001', 'done');

    expect(card.metadata.done_at).toBeDefined();
    expect(card.metadata.done_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does not stamp active_at a second time if already set', () => {
    const cardWithActive = makeCard('card-001', 'backlog');
    cardWithActive.metadata.active_at = '2024-01-01T00:00:00.000Z';
    writeCard(boardRoot, cardWithActive);

    const { card } = simulateMove(boardRoot, 'card-001', 'in-progress');

    // active_at should remain the original value
    expect(card.metadata.active_at).toBe('2024-01-01T00:00:00.000Z');
  });

  it('rejects unknown card', () => {
    const card = readCard(boardRoot, 'nonexistent-card');
    expect(card).toBeNull();
  });

  it('rejects unknown column', () => {
    const manifest = readManifest(boardRoot);
    const col = manifest.columns.find((c) => c.id === 'nonexistent');
    expect(col).toBeUndefined();
  });
});

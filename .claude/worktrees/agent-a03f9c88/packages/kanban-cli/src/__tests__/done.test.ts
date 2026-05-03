import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCard, writeCard, readManifest } from '@personal-kanban/core';
import type { Card } from '@personal-kanban/core';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pk-cli-done-test-'));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeManifest(boardRoot: string): void {
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

/** Simulate the done command logic */
function simulateDone(boardRoot: string, cardId: string): Card {
  const manifest = readManifest(boardRoot);
  const doneColId = manifest.column_stamps?.done_at ?? 'done';
  const card = readCard(boardRoot, cardId);
  if (!card) throw new Error(`Card ${cardId} not found`);

  const now = new Date().toISOString();
  const updatedCard: Card = {
    ...card,
    metadata: {
      ...card.metadata,
      column: doneColId,
      done_at: now,
    },
  };
  writeCard(boardRoot, updatedCard);
  return updatedCard;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('done command', () => {
  let tmpDir: string;
  let boardRoot: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    boardRoot = path.join(tmpDir, '.personal-kanban');
    writeManifest(boardRoot);
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it('moves card to done column', () => {
    writeCard(boardRoot, makeCard('card-001', 'in-progress'));
    simulateDone(boardRoot, 'card-001');

    const card = readCard(boardRoot, 'card-001');
    expect(card).not.toBeNull();
    expect(card!.metadata.column).toBe('done');
  });

  it('sets done_at timestamp', () => {
    writeCard(boardRoot, makeCard('card-001', 'in-progress'));
    const before = new Date().toISOString();
    simulateDone(boardRoot, 'card-001');
    const after = new Date().toISOString();

    const card = readCard(boardRoot, 'card-001');
    expect(card).not.toBeNull();
    expect(card!.metadata.done_at).toBeDefined();
    expect(card!.metadata.done_at! >= before).toBe(true);
    expect(card!.metadata.done_at! <= after).toBe(true);
  });

  it('preserves other card metadata', () => {
    const original = makeCard('card-001', 'in-progress');
    original.metadata.active_at = '2024-01-15T12:00:00.000Z';
    writeCard(boardRoot, original);
    simulateDone(boardRoot, 'card-001');

    const card = readCard(boardRoot, 'card-001');
    expect(card!.metadata.active_at).toBe('2024-01-15T12:00:00.000Z');
    expect(card!.metadata.created_at).toBe('2024-01-15T10:00:00.000Z');
  });

  it('throws for nonexistent card', () => {
    expect(() => simulateDone(boardRoot, 'nonexistent-card')).toThrow('Card nonexistent-card not found');
  });
});

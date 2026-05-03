/* eslint-disable @typescript-eslint/no-var-requires */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeCard, loadBoardState, archiveCardFile, getArchivePath, getCardPath } from '@personal-kanban/core';
import type { Card } from '@personal-kanban/core';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pk-cli-archive-test-'));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeManifest(boardRoot: string): void {
  fs.mkdirSync(boardRoot, { recursive: true });
  fs.mkdirSync(path.join(boardRoot, 'cards'), { recursive: true });
  fs.mkdirSync(path.join(boardRoot, 'archive'), { recursive: true });
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

/** Simulate the archive command logic */
function simulateArchive(boardRoot: string): string[] {
  const { readManifest } = require('@personal-kanban/core');
  const manifest = readManifest(boardRoot);
  const doneColId = manifest.column_stamps?.done_at ?? 'done';
  const state = loadBoardState(boardRoot);

  const doneCol = state.manifest.columns.find((c: { id: string }) => c.id === doneColId);
  const doneCardIds: string[] = doneCol?.cards ?? [];

  for (const cardId of doneCardIds) {
    archiveCardFile(boardRoot, cardId);
  }

  return doneCardIds;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('archive command', () => {
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

  it('moves done cards to archive directory', () => {
    writeCard(boardRoot, makeCard('card-001', 'done'));
    writeCard(boardRoot, makeCard('card-002', 'done'));

    simulateArchive(boardRoot);

    expect(fs.existsSync(getArchivePath(boardRoot, 'card-001'))).toBe(true);
    expect(fs.existsSync(getArchivePath(boardRoot, 'card-002'))).toBe(true);
  });

  it('removes done cards from cards directory', () => {
    writeCard(boardRoot, makeCard('card-001', 'done'));

    simulateArchive(boardRoot);

    expect(fs.existsSync(getCardPath(boardRoot, 'card-001'))).toBe(false);
  });

  it('does not archive cards in other columns', () => {
    writeCard(boardRoot, makeCard('card-001', 'done'));
    writeCard(boardRoot, makeCard('card-002', 'backlog'));
    writeCard(boardRoot, makeCard('card-003', 'in-progress'));

    const archived = simulateArchive(boardRoot);

    expect(archived).toHaveLength(1);
    expect(archived).toContain('card-001');

    // non-done cards should remain in cards dir
    expect(fs.existsSync(getCardPath(boardRoot, 'card-002'))).toBe(true);
    expect(fs.existsSync(getCardPath(boardRoot, 'card-003'))).toBe(true);
  });

  it('returns empty list when no done cards', () => {
    writeCard(boardRoot, makeCard('card-001', 'backlog'));

    const archived = simulateArchive(boardRoot);

    expect(archived).toHaveLength(0);
    expect(fs.existsSync(getCardPath(boardRoot, 'card-001'))).toBe(true);
  });
});

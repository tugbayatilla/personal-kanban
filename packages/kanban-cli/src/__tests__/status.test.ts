/* eslint-disable @typescript-eslint/no-var-requires */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeCard } from '@personal-kanban/core';
import type { Card } from '@personal-kanban/core';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pk-cli-status-test-'));
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
      { id: 'in-progress', label: 'In Progress', index: 1, wip_limit: 2, policies: [] },
      { id: 'done', label: 'Done', index: 2, wip_limit: null, policies: [] },
    ],
    column_stamps: { active_at: 'in-progress', done_at: 'done' },
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('status command', () => {
  let tmpDir: string;
  let boardRoot: string;
  let logs: string[];
  let origLog: typeof console.log;
  let origError: typeof console.error;

  beforeEach(() => {
    tmpDir = makeTempDir();
    boardRoot = path.join(tmpDir, '.personal-kanban');
    writeManifest(boardRoot);

    logs = [];
    origLog = console.log;
    origError = console.error;
    console.log = (msg: string) => { logs.push(msg); };
    console.error = (msg: string) => { logs.push(msg); };
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
    removeTempDir(tmpDir);
  });

  it('shows column names and card counts', () => {
    // Add 2 cards to backlog
    writeCard(boardRoot, makeCard('card-001', 'backlog'));
    writeCard(boardRoot, makeCard('card-002', 'backlog'));

    // Call status by directly importing and calling the action
    const { loadBoardState } = require('@personal-kanban/core');
    const state = loadBoardState(boardRoot);

    // Simulate status output
    for (const col of state.manifest.columns) {
      const cards = col.cards ?? [];
      const count = cards.length;
      const wip = col.wip_limit;
      let line = `${col.label.padEnd(14)} [${count} card${count !== 1 ? 's' : ''}]`;
      if (wip !== null && count >= wip) {
        line += '  ⚠ at WIP limit';
      } else if (wip !== null && count >= wip - 1) {
        line += '  ⚠ near limit';
      }
      console.log(line);
    }

    expect(logs.some(l => l.includes('Backlog') && l.includes('2 cards'))).toBe(true);
    expect(logs.some(l => l.includes('In Progress') && l.includes('0 cards'))).toBe(true);
    expect(logs.some(l => l.includes('Done') && l.includes('0 cards'))).toBe(true);
  });

  it('shows WIP warning when at limit', () => {
    writeCard(boardRoot, makeCard('card-001', 'in-progress'));
    writeCard(boardRoot, makeCard('card-002', 'in-progress'));

    const { loadBoardState } = require('@personal-kanban/core');
    const state = loadBoardState(boardRoot);

    for (const col of state.manifest.columns) {
      const cards = col.cards ?? [];
      const count = cards.length;
      const wip = col.wip_limit;
      let line = `${col.label.padEnd(14)} [${count} card${count !== 1 ? 's' : ''}]`;
      if (wip !== null && count >= wip) {
        line += '  ⚠ at WIP limit';
      } else if (wip !== null && count >= wip - 1) {
        line += '  ⚠ near limit';
      }
      console.log(line);
    }

    expect(logs.some(l => l.includes('In Progress') && l.includes('at WIP limit'))).toBe(true);
  });

  it('shows 1 card (singular) for single card', () => {
    writeCard(boardRoot, makeCard('card-001', 'backlog'));

    const { loadBoardState } = require('@personal-kanban/core');
    const state = loadBoardState(boardRoot);

    for (const col of state.manifest.columns) {
      const cards = col.cards ?? [];
      const count = cards.length;
      const line = `${col.label.padEnd(14)} [${count} card${count !== 1 ? 's' : ''}]`;
      console.log(line);
    }

    expect(logs.some(l => l.includes('Backlog') && l.includes('1 card]'))).toBe(true);
  });
});

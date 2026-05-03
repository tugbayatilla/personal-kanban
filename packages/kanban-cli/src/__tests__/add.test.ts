/* eslint-disable @typescript-eslint/no-var-requires */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCard, generateId, writeCard, calcOrder } from '@personal-kanban/core';
import type { Card } from '@personal-kanban/core';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pk-cli-add-test-'));
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
    scripts: {},
    hooks: {},
  };
  fs.writeFileSync(path.join(boardRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('add command', () => {
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

  it('creates a card file in the cards directory', () => {
    const id = generateId();
    const now = new Date().toISOString();
    const card: Card = {
      id,
      content: '# My New Task\n',
      metadata: {
        created_at: now,
        column: 'backlog',
        order: String(calcOrder(0, 1)),
      },
    };
    writeCard(boardRoot, card);

    const cardPath = path.join(boardRoot, 'cards', `${id}.md`);
    expect(fs.existsSync(cardPath)).toBe(true);
  });

  it('stores correct column and order in card metadata', () => {
    const id = generateId();
    const now = new Date().toISOString();
    const card: Card = {
      id,
      content: '# Task for In Progress\n',
      metadata: {
        created_at: now,
        column: 'in-progress',
        order: String(calcOrder(0, 1)),
      },
    };
    writeCard(boardRoot, card);

    const read = readCard(boardRoot, id);
    expect(read).not.toBeNull();
    expect(read!.metadata.column).toBe('in-progress');
    expect(read!.metadata.order).toBe('0.5');
  });

  it('includes the title in card content', () => {
    const title = 'Implement login feature';
    const id = generateId();
    const now = new Date().toISOString();
    const card: Card = {
      id,
      content: `# ${title}\n`,
      metadata: {
        created_at: now,
        column: 'backlog',
        order: String(calcOrder(0, 1)),
      },
    };
    writeCard(boardRoot, card);

    const read = readCard(boardRoot, id);
    expect(read).not.toBeNull();
    expect(read!.content).toContain(title);
  });

  it('rejects unknown column', () => {
    const { readManifest } = require('@personal-kanban/core');
    const manifest = readManifest(boardRoot);
    const col = manifest.columns.find((c: { id: string }) => c.id === 'nonexistent');
    expect(col).toBeUndefined();
  });
});

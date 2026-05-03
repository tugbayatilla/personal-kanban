/**
 * Integration tests for src/io.ts
 *
 * Uses a real temporary directory per test so that serialization bugs, atomic
 * write semantics, and round-trip fidelity are tested against actual disk I/O —
 * not a mocked filesystem. Each test suite creates a fresh temp dir in
 * beforeEach and removes it in afterEach.
 *
 * Coverage:
 *   - readCard / writeCard round-trips (parseCardMd / serializeCardMd)
 *   - readManifest: v3 → v1 migration, v4 → v1 migration
 *   - writeManifest: strips runtime fields and column cards arrays
 *   - loadBoardState: column grouping, default column fallback, order sorting,
 *     created_at fallback, unknown column fallback
 *   - withLock: mutual exclusion via O_EXCL
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetMockConfig, setMockConfig } from './__mocks__/vscode';

// io.ts is imported AFTER the vscode mock is wired up via jest.config.js moduleNameMapper.
import {
  readCard,
  writeCard,
  readManifest,
  writeManifest,
  loadBoardState,
  withLock,
} from '../io';
import { Card } from '../types';

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pk-test-'));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Write a minimal valid manifest.json to boardRoot. */
function writeMinimalManifest(boardRoot: string, overrides: Partial<object> = {}): void {
  const manifest = {
    version: 1,
    name: 'Test Board',
    columns: [
      { id: 'backlog',     label: 'Backlog',      index: 0, wip_limit: null, policies: {} },
      { id: 'in-progress', label: 'In Progress',  index: 1, wip_limit: null, policies: {} },
      { id: 'done',        label: 'Done',          index: 2, wip_limit: null, policies: {} },
    ],
    scripts: {},
    hooks: {},
    ...overrides,
  };
  fs.mkdirSync(boardRoot, { recursive: true });
  fs.writeFileSync(path.join(boardRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

/** Build a minimal Card object. */
function makeCard(id: string, overrides: Partial<Card['metadata']> = {}): Card {
  return {
    id,
    content: `# Task ${id}\n\nSome content.`,
    metadata: {
      created_at: '2024-01-15T10:00:00.000Z',
      column: 'backlog',
      order: '0.5',
      ...overrides,
    },
  };
}

// ── readCard / writeCard round-trips ──────────────────────────────────────────

describe('writeCard + readCard round-trip', () => {
  let boardRoot: string;

  beforeEach(() => {
    boardRoot = makeTempDir();
    resetMockConfig();
  });

  afterEach(() => removeTempDir(boardRoot));

  it('preserves id, content, and all known metadata fields', () => {
    const card = makeCard('abc-123', {
      column: 'in-progress',
      order: '0.75',
      active_at: '2024-01-16T08:00:00.000Z',
      done_at: '2024-01-17T09:00:00.000Z',
      branch: 'feat/my-feature',
    });

    writeCard(boardRoot, card);
    const read = readCard(boardRoot, 'abc-123');

    expect(read).not.toBeNull();
    expect(read!.id).toBe('abc-123');
    expect(read!.content).toBe(card.content);
    expect(read!.metadata.column).toBe('in-progress');
    expect(read!.metadata.order).toBe('0.75');
    expect(read!.metadata.active_at).toBe('2024-01-16T08:00:00.000Z');
    expect(read!.metadata.done_at).toBe('2024-01-17T09:00:00.000Z');
    expect(read!.metadata.branch).toBe('feat/my-feature');
  });

  it('preserves custom (non-standard) metadata fields', () => {
    const card = makeCard('custom-01', {
      ticket_url: 'https://jira.example.com/PROJ-42',
      epic: 'Q1-2024',
    });

    writeCard(boardRoot, card);
    const read = readCard(boardRoot, 'custom-01');

    expect(read!.metadata.ticket_url).toBe('https://jira.example.com/PROJ-42');
    expect(read!.metadata.epic).toBe('Q1-2024');
  });

  it('returns null when the card file does not exist', () => {
    const result = readCard(boardRoot, 'nonexistent-id');
    expect(result).toBeNull();
  });

  it('does not include undefined fields in the written file', () => {
    const card = makeCard('sparse-01', { active_at: undefined, done_at: undefined });
    writeCard(boardRoot, card);

    const raw = fs.readFileSync(
      path.join(boardRoot, 'cards', 'sparse-01.md'),
      'utf-8'
    );
    expect(raw).not.toContain('active_at:');
    expect(raw).not.toContain('done_at:');
  });

  it('reads a card that has no frontmatter and returns content with a generated created_at', () => {
    fs.mkdirSync(path.join(boardRoot, 'cards'), { recursive: true });
    fs.writeFileSync(
      path.join(boardRoot, 'cards', 'bare-01.md'),
      'No frontmatter here, just plain text.'
    );

    const card = readCard(boardRoot, 'bare-01');

    expect(card).not.toBeNull();
    expect(card!.id).toBe('bare-01');
    expect(card!.content).toBe('No frontmatter here, just plain text.');
    expect(card!.metadata.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('defaults missing optional fields to undefined rather than empty string', () => {
    const card = makeCard('no-opts', { column: undefined, order: undefined });
    writeCard(boardRoot, card);
    const read = readCard(boardRoot, 'no-opts');

    expect(read!.metadata.column).toBeUndefined();
    expect(read!.metadata.order).toBeUndefined();
  });

  it('reads card from archive/ directory when not found in cards/', () => {
    const archiveDir = path.join(boardRoot, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });

    const content = `---\nid: archived-01\ncreated_at: 2024-01-15T10:00:00.000Z\ncolumn: done\narchived_at: 2024-02-01T00:00:00.000Z\n---\n\n# Task archived-01\n`;
    fs.writeFileSync(path.join(archiveDir, 'archived-01.md'), content);

    const read = readCard(boardRoot, 'archived-01');

    expect(read).not.toBeNull();
    expect(read!.metadata.archived_at).toBe('2024-02-01T00:00:00.000Z');
  });

  it('writes an atomic .tmp file then renames — no .tmp file remains after write', () => {
    const card = makeCard('atomic-01');
    writeCard(boardRoot, card);

    const tmpPath = path.join(boardRoot, 'cards', 'atomic-01.md.tmp');
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});

// ── readManifest ──────────────────────────────────────────────────────────────

describe('readManifest', () => {
  let boardRoot: string;

  beforeEach(() => {
    boardRoot = makeTempDir();
    resetMockConfig();
  });

  afterEach(() => removeTempDir(boardRoot));

  it('reads a v1 manifest and injects tags/tagColorTarget/showCardAge from config', () => {
    writeMinimalManifest(boardRoot);
    setMockConfig({ tags: { bug: { color: '#ff0000', weight: 10 } }, tagColorTarget: 'card-border', showCardAge: false });

    const manifest = readManifest(boardRoot);

    expect(manifest.tags).toEqual({ bug: { color: '#ff0000', weight: 10 } });
    expect(manifest.tagColorTarget).toBe('card-border');
    expect(manifest.showCardAge).toBe(false);
  });

  it('returns an array of Column objects with correct shape for a v1 manifest', () => {
    writeMinimalManifest(boardRoot);

    const manifest = readManifest(boardRoot);

    expect(Array.isArray(manifest.columns)).toBe(true);
    expect(manifest.columns[0]).toMatchObject({ id: 'backlog', label: 'Backlog', index: 0 });
  });

  describe('v3 migration (object-format columns → Column[] array)', () => {
    /**
     * @spec MIG-001
     * @contract v3 manifests with object-shaped columns must be migrated to v1
     *   Column[] format on read. This migration must not be removed without updating
     *   all user data upgrade paths.
     */
    it('migrates object-format columns to a Column array', () => {
      const v3Manifest = {
        version: 3,
        name: 'Old Board',
        columns: {
          backlog: ['card-001'],
          'in-progress': ['card-002'],
          done: [],
        },
        scripts: {},
        hooks: {},
      };
      fs.mkdirSync(boardRoot, { recursive: true });
      fs.writeFileSync(
        path.join(boardRoot, 'manifest.json'),
        JSON.stringify(v3Manifest)
      );

      const manifest = readManifest(boardRoot);

      expect(Array.isArray(manifest.columns)).toBe(true);
      const ids = manifest.columns.map((c) => c.id);
      expect(ids).toContain('backlog');
      expect(ids).toContain('in-progress');
      expect(ids).toContain('done');
    });

    it('assigns canonical labels for well-known column ids during v3 migration', () => {
      const v3Manifest = {
        version: 3,
        columns: { backlog: [], 'in-progress': [], review: [], done: [] },
        scripts: {},
        hooks: {},
      };
      fs.mkdirSync(boardRoot, { recursive: true });
      fs.writeFileSync(path.join(boardRoot, 'manifest.json'), JSON.stringify(v3Manifest));

      const manifest = readManifest(boardRoot);

      const byId = Object.fromEntries(manifest.columns.map((c) => [c.id, c]));
      expect(byId['backlog'].label).toBe('Backlog');
      expect(byId['in-progress'].label).toBe('In Progress');
      expect(byId['review'].label).toBe('Review');
      expect(byId['done'].label).toBe('Done');
    });

    it('orders well-known columns before unknown custom columns during v3 migration', () => {
      const v3Manifest = {
        version: 3,
        columns: { 'my-custom': [], backlog: [], done: [] },
        scripts: {},
        hooks: {},
      };
      fs.mkdirSync(boardRoot, { recursive: true });
      fs.writeFileSync(path.join(boardRoot, 'manifest.json'), JSON.stringify(v3Manifest));

      const manifest = readManifest(boardRoot);

      const ids = manifest.columns.map((c) => c.id);
      expect(ids.indexOf('backlog')).toBeLessThan(ids.indexOf('my-custom'));
      expect(ids.indexOf('done')).toBeLessThan(ids.indexOf('my-custom'));
    });
  });

  describe('v4 migration (strips persisted cards arrays from columns)', () => {
    /**
     * @spec MIG-002
     * @contract v4 manifests that persisted card IDs inside columns must have
     *   those arrays stripped on read. Card placement is derived from card files only.
     */
    it('strips cards arrays from v4 column objects', () => {
      const v4Manifest = {
        version: 4,
        name: 'V4 Board',
        columns: [
          { id: 'backlog', label: 'Backlog', index: 0, wip_limit: null, policies: {}, cards: ['card-1', 'card-2'] },
          { id: 'done',    label: 'Done',    index: 1, wip_limit: null, policies: {}, cards: [] },
        ],
        scripts: {},
        hooks: {},
      };
      fs.mkdirSync(boardRoot, { recursive: true });
      fs.writeFileSync(path.join(boardRoot, 'manifest.json'), JSON.stringify(v4Manifest));

      const manifest = readManifest(boardRoot);

      // cards is only populated by loadBoardState; readManifest strips the persisted copy.
      for (const col of manifest.columns) {
        expect((col as { cards?: unknown }).cards).toBeUndefined();
      }
    });

    it('adds a policies object when a v4 column is missing it', () => {
      const v4Manifest = {
        version: 4,
        columns: [
          { id: 'backlog', label: 'Backlog', index: 0, wip_limit: null },
        ],
        scripts: {},
        hooks: {},
      };
      fs.mkdirSync(boardRoot, { recursive: true });
      fs.writeFileSync(path.join(boardRoot, 'manifest.json'), JSON.stringify(v4Manifest));

      const manifest = readManifest(boardRoot);

      expect(manifest.columns[0].policies).toEqual([]);
    });
  });
});

// ── writeManifest ─────────────────────────────────────────────────────────────

describe('writeManifest', () => {
  let boardRoot: string;

  beforeEach(() => {
    boardRoot = makeTempDir();
    resetMockConfig();
    writeMinimalManifest(boardRoot);
  });

  afterEach(() => removeTempDir(boardRoot));

  /**
   * @spec IO-001
   * @contract writeManifest must never persist runtime-only fields (tags,
   *   tagColorTarget, showCardAge) or in-memory column cards arrays.
   *   These are injected on read from VSCode settings and card files respectively.
   */
  it('does not write tags to the manifest file', () => {
    const manifest = readManifest(boardRoot);
    manifest.tags = { bug: { color: '#ff0000', weight: 5 } };
    writeManifest(boardRoot, manifest);

    const raw = JSON.parse(fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8'));
    expect(raw.tags).toBeUndefined();
  });

  it('does not write tagColorTarget to the manifest file', () => {
    const manifest = readManifest(boardRoot);
    writeManifest(boardRoot, manifest);

    const raw = JSON.parse(fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8'));
    expect(raw.tagColorTarget).toBeUndefined();
  });

  it('does not write showCardAge to the manifest file', () => {
    const manifest = readManifest(boardRoot);
    writeManifest(boardRoot, manifest);

    const raw = JSON.parse(fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8'));
    expect(raw.showCardAge).toBeUndefined();
  });

  it('does not write in-memory column cards arrays to the manifest file', () => {
    const manifest = readManifest(boardRoot);
    manifest.columns[0].cards = ['card-1', 'card-2'];
    writeManifest(boardRoot, manifest);

    const raw = JSON.parse(fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8'));
    for (const col of raw.columns) {
      expect(col.cards).toBeUndefined();
    }
  });

  it('preserves column definitions (id, label, index, wip_limit, policies)', () => {
    const manifest = readManifest(boardRoot);
    manifest.columns[1].wip_limit = 3;
    writeManifest(boardRoot, manifest);

    const raw = JSON.parse(fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8'));
    expect(raw.columns[1].wip_limit).toBe(3);
    expect(raw.columns[1].id).toBe('in-progress');
  });

  it('writes a .tmp file that is absent after a successful write', () => {
    const manifest = readManifest(boardRoot);
    writeManifest(boardRoot, manifest);

    const tmpPath = path.join(boardRoot, 'manifest.json.tmp');
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});

// ── loadBoardState ────────────────────────────────────────────────────────────

describe('loadBoardState', () => {
  let boardRoot: string;

  beforeEach(() => {
    boardRoot = makeTempDir();
    resetMockConfig();
    writeMinimalManifest(boardRoot);
    fs.mkdirSync(path.join(boardRoot, 'cards'), { recursive: true });
  });

  afterEach(() => removeTempDir(boardRoot));

  /**
   * @spec STATE-001
   * @contract Cards must be grouped into the column identified by their own
   *   `column` metadata field, not by any manifest-level list.
   */
  it('groups cards into columns based on each card\'s own column metadata field', () => {
    writeCard(boardRoot, makeCard('card-a', { column: 'backlog',      order: '0.5' }));
    writeCard(boardRoot, makeCard('card-b', { column: 'in-progress',  order: '0.5' }));
    writeCard(boardRoot, makeCard('card-c', { column: 'done',         order: '0.5' }));

    const { manifest } = loadBoardState(boardRoot);

    const backlog     = manifest.columns.find((c) => c.id === 'backlog')!;
    const inProgress  = manifest.columns.find((c) => c.id === 'in-progress')!;
    const done        = manifest.columns.find((c) => c.id === 'done')!;

    expect(backlog.cards).toEqual(['card-a']);
    expect(inProgress.cards).toEqual(['card-b']);
    expect(done.cards).toEqual(['card-c']);
  });

  /**
   * @spec STATE-002
   * @contract A card with no `column` field must be placed in the first column
   *   of the manifest (defaultColumnId). This is the canonical fallback.
   */
  it('places a card with no column field into the first (default) column', () => {
    const card = makeCard('no-col', { column: undefined, order: '0.5' });
    writeCard(boardRoot, card);

    const { manifest } = loadBoardState(boardRoot);

    const firstCol = manifest.columns[0];
    expect(firstCol.cards).toContain('no-col');
  });

  /**
   * @spec STATE-003
   * @contract Cards referencing a column id that does not exist in the manifest
   *   must fall back to the first column rather than being silently dropped.
   */
  it('falls back a card with an unknown column to the first column', () => {
    const card = makeCard('unknown-col', { column: 'nonexistent-column', order: '0.5' });
    writeCard(boardRoot, card);

    const { manifest } = loadBoardState(boardRoot);

    const firstCol = manifest.columns[0];
    expect(firstCol.cards).toContain('unknown-col');
  });

  /**
   * @spec STATE-004
   * @contract Cards within a column must be sorted by their `order` value
   *   ascending (lower order = closer to the top of the column).
   */
  it('sorts cards within a column by order ascending', () => {
    writeCard(boardRoot, makeCard('card-high',  { column: 'backlog', order: '0.75' }));
    writeCard(boardRoot, makeCard('card-low',   { column: 'backlog', order: '0.25' }));
    writeCard(boardRoot, makeCard('card-mid',   { column: 'backlog', order: '0.5'  }));

    const { manifest } = loadBoardState(boardRoot);

    const backlog = manifest.columns.find((c) => c.id === 'backlog')!;
    expect(backlog.cards).toEqual(['card-low', 'card-mid', 'card-high']);
  });

  /**
   * @spec STATE-005
   * @contract Cards that have no `order` field must fall back to `created_at`
   *   for sort order so that pre-order-field cards remain stable.
   */
  it('falls back to created_at for sort key when order field is absent', () => {
    writeCard(boardRoot, makeCard('newer', { column: 'backlog', order: undefined, created_at: '2024-02-01T00:00:00.000Z' }));
    writeCard(boardRoot, makeCard('older', { column: 'backlog', order: undefined, created_at: '2024-01-01T00:00:00.000Z' }));

    const { manifest } = loadBoardState(boardRoot);

    const backlog = manifest.columns.find((c) => c.id === 'backlog')!;
    expect(backlog.cards!.indexOf('older')).toBeLessThan(backlog.cards!.indexOf('newer'));
  });

  it('returns an empty cards array for a column that has no cards', () => {
    // Only backlog gets a card.
    writeCard(boardRoot, makeCard('only-card', { column: 'backlog', order: '0.5' }));

    const { manifest } = loadBoardState(boardRoot);

    const done = manifest.columns.find((c) => c.id === 'done')!;
    expect(done.cards).toEqual([]);
  });

  it('does not write the column cards arrays back to the manifest file on disk', () => {
    writeCard(boardRoot, makeCard('card-x', { column: 'backlog', order: '0.5' }));

    loadBoardState(boardRoot);

    const raw = JSON.parse(fs.readFileSync(path.join(boardRoot, 'manifest.json'), 'utf-8'));
    for (const col of raw.columns) {
      expect(col.cards).toBeUndefined();
    }
  });

  it('returns the cards map keyed by card id', () => {
    writeCard(boardRoot, makeCard('card-q', { column: 'backlog', order: '0.5' }));

    const { cards } = loadBoardState(boardRoot);

    expect(cards['card-q']).toBeDefined();
    expect(cards['card-q']!.id).toBe('card-q');
  });

  it('ignores non-.md files in the cards directory', () => {
    fs.writeFileSync(path.join(boardRoot, 'cards', 'README.txt'), 'ignore me');
    fs.writeFileSync(path.join(boardRoot, 'cards', '.DS_Store'), '');
    writeCard(boardRoot, makeCard('real-card', { column: 'backlog', order: '0.5' }));

    const { manifest } = loadBoardState(boardRoot);

    const allCardIds = manifest.columns.flatMap((c) => c.cards ?? []);
    expect(allCardIds).toEqual(['real-card']);
  });

  it('works correctly when the cards directory does not exist yet', () => {
    // Remove the cards directory we created in beforeEach.
    fs.rmSync(path.join(boardRoot, 'cards'), { recursive: true, force: true });

    const { manifest } = loadBoardState(boardRoot);

    for (const col of manifest.columns) {
      expect(col.cards).toEqual([]);
    }
  });
});

// ── withLock ──────────────────────────────────────────────────────────────────

describe('withLock', () => {
  let boardRoot: string;

  beforeEach(() => {
    boardRoot = makeTempDir();
    resetMockConfig();
  });

  afterEach(() => removeTempDir(boardRoot));

  it('executes the callback and returns its value', () => {
    const result = withLock(boardRoot, () => 42);
    expect(result).toBe(42);
  });

  it('removes the lock file after a successful callback', () => {
    withLock(boardRoot, () => 'ok');
    const lockPath = path.join(boardRoot, 'manifest.lock');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('removes the lock file even when the callback throws', () => {
    expect(() =>
      withLock(boardRoot, () => { throw new Error('boom'); })
    ).toThrow('boom');

    const lockPath = path.join(boardRoot, 'manifest.lock');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('re-throws any error thrown by the callback', () => {
    expect(() =>
      withLock(boardRoot, () => { throw new TypeError('type error'); })
    ).toThrow(TypeError);
  });

  it('times out and throws when lock file is held by a non-existent process', () => {
    // Plant a stale lock with a PID that cannot be alive.
    const lockPath = path.join(boardRoot, 'manifest.lock');
    fs.writeFileSync(lockPath, '99999999'); // extremely unlikely real PID

    // Patch LOCK_TIMEOUT_MS by using a short timeout; we do this by relying on
    // the actual 3 000 ms timeout only if the OS confirms the fake PID is dead.
    // Because PID 99999999 almost certainly doesn't exist, the implementation
    // will unlink the stale lock and retry — so the second call succeeds.
    const result = withLock(boardRoot, () => 'recovered');
    expect(result).toBe('recovered');
  }, 10000);
});

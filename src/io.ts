import * as fs from 'fs';
import * as path from 'path';
import { Card, Column, ColumnConfig, Manifest } from './types';

// V3 stored format (disk) — structure only, no config
interface StoredManifest {
  version: number;
  columns: Record<string, string[]>; // columnId → ordered card IDs
}

// Default column config used when VSCode settings are absent
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'backlog',     label: 'Backlog',      wipLimit: null },
  { id: 'refined',    label: 'Refined',      wipLimit: null },
  { id: 'in-progress',label: 'In Progress',  wipLimit: 1    },
  { id: 'review',     label: 'Review',       wipLimit: null },
  { id: 'done',       label: 'Done',         wipLimit: null },
];

// ── Paths ─────────────────────────────────────────────────────────────────────

export function getBoardRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.personal-kanban');
}

export function getManifestPath(boardRoot: string): string {
  return path.join(boardRoot, 'manifest.json');
}

export function boardExists(boardRoot: string): boolean {
  return fs.existsSync(getManifestPath(boardRoot));
}

function getCardDir(boardRoot: string, id: string): string {
  return path.join(boardRoot, 'cards', id);
}

function getCardFilePath(boardRoot: string, id: string): string {
  return path.join(getCardDir(boardRoot, id), `${id}.md`);
}

function getCardLogPath(boardRoot: string, id: string): string {
  return path.join(getCardDir(boardRoot, id), `${id}.log`);
}

// ── Stored manifest (V3) ──────────────────────────────────────────────────────

function readStoredManifest(boardRoot: string): StoredManifest {
  const raw = fs.readFileSync(getManifestPath(boardRoot), 'utf-8');
  const parsed = JSON.parse(raw);
  if (parsed.version !== 3) {
    return migrateToV3(boardRoot, parsed);
  }
  return parsed as StoredManifest;
}

function writeStoredManifest(boardRoot: string, stored: StoredManifest): void {
  const target = getManifestPath(boardRoot);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(stored, null, 2), 'utf-8');
  fs.renameSync(tmp, target);
}

/**
 * Migrate any pre-v3 manifest to v3.
 * Moves card files from cards/{column}/{id}.md → cards/{id}/{id}.md
 * Moves logs from logs/cards/{id}.log → cards/{id}/{id}.log
 */
function migrateToV3(boardRoot: string, legacy: Record<string, unknown>): StoredManifest {
  const legacyCols = (legacy.columns ?? []) as Array<{
    id: string;
    folder?: string;
    cards?: string[];
  }>;

  // Collect all card IDs in column order for the stored manifest
  const storedColumns: Record<string, string[]> = {};

  for (const col of legacyCols) {
    const colFolder = col.folder
      ? path.join(boardRoot, col.folder)
      : path.join(boardRoot, 'cards', col.id);
    const cardIds = col.cards ?? [];
    storedColumns[col.id] = cardIds;

    for (const id of cardIds) {
      const dstDir = getCardDir(boardRoot, id);

      // Move card .md file
      const srcMd = path.join(colFolder, `${id}.md`);
      const dstMd = getCardFilePath(boardRoot, id);
      if (fs.existsSync(srcMd) && !fs.existsSync(dstMd)) {
        fs.mkdirSync(dstDir, { recursive: true });
        fs.renameSync(srcMd, dstMd);
      }

      // Move card .log file from logs/cards/
      const srcLog = path.join(boardRoot, 'logs', 'cards', `${id}.log`);
      const dstLog = getCardLogPath(boardRoot, id);
      if (fs.existsSync(srcLog) && !fs.existsSync(dstLog)) {
        fs.mkdirSync(dstDir, { recursive: true });
        fs.renameSync(srcLog, dstLog);
      }
    }
  }

  const v3: StoredManifest = { version: 3, columns: storedColumns };
  writeStoredManifest(boardRoot, v3);

  // Create board.log if absent
  const boardLogPath = path.join(boardRoot, 'board.log');
  if (!fs.existsSync(boardLogPath)) {
    fs.writeFileSync(boardLogPath, '', 'utf-8');
  }

  return v3;
}

// ── Runtime manifest (combines stored + settings) ─────────────────────────────

function buildManifest(
  stored: StoredManifest,
  columnConfigs: ColumnConfig[],
  tags: Record<string, { color: string }>,
  hooks: Record<string, { file: string }>
): Manifest {
  // Determine column order: configs first (in settings order), then any extras from stored
  const configIds = new Set(columnConfigs.map((c) => c.id));
  const extraIds = Object.keys(stored.columns).filter((id) => !configIds.has(id));

  const columns: Column[] = [
    ...columnConfigs.map((cfg) => ({
      id: cfg.id,
      label: cfg.label,
      wip_limit: cfg.wipLimit,
      cards: stored.columns[cfg.id] ?? [],
    })),
    ...extraIds.map((id) => ({
      id,
      label: id,
      wip_limit: null,
      cards: stored.columns[id],
    })),
  ];

  return { version: stored.version, name: 'personal-kanban', columns, tags, hooks };
}

export function readManifest(
  boardRoot: string,
  columnConfigs?: ColumnConfig[],
  tags?: Record<string, { color: string }>,
  hooks?: Record<string, { file: string }>
): Manifest {
  const stored = readStoredManifest(boardRoot);
  return buildManifest(
    stored,
    columnConfigs ?? DEFAULT_COLUMNS,
    tags ?? {},
    hooks ?? {}
  );
}

export function writeManifest(boardRoot: string, manifest: Manifest): void {
  const stored: StoredManifest = { version: 3, columns: {} };
  for (const col of manifest.columns) {
    stored.columns[col.id] = col.cards;
  }
  writeStoredManifest(boardRoot, stored);
}

// ── Card serialization ────────────────────────────────────────────────────────

function parseCardMd(raw: string, id: string): Card {
  const now = new Date().toISOString();
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { id, content: raw, metadata: { created_at: now, updated_at: now } };
  }
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return {
    id,
    content: match[2].replace(/^\n/, ''),
    metadata: {
      created_at: fm.created_at ?? now,
      updated_at: fm.updated_at ?? now,
      ...(fm.branch ? { branch: fm.branch } : {}),
    },
  };
}

function serializeCardMd(card: Card): string {
  const lines = [
    '---',
    `id: ${card.id}`,
    `created_at: ${card.metadata.created_at}`,
    `updated_at: ${card.metadata.updated_at}`,
  ];
  if (card.metadata.branch) {
    lines.push(`branch: ${card.metadata.branch}`);
  }
  lines.push('---', '');
  lines.push(card.content);
  return lines.join('\n');
}

// ── Card I/O ──────────────────────────────────────────────────────────────────

export function readCard(boardRoot: string, id: string, _manifest?: Manifest): Card | null {
  // V3: cards/{id}/{id}.md
  const v3Path = getCardFilePath(boardRoot, id);
  if (fs.existsSync(v3Path)) {
    return parseCardMd(fs.readFileSync(v3Path, 'utf-8'), id);
  }
  return null;
}

export function writeCard(boardRoot: string, card: Card, _column?: Column): void {
  card.metadata.updated_at = new Date().toISOString();
  const dir = getCardDir(boardRoot, card.id);
  fs.mkdirSync(dir, { recursive: true });
  const target = getCardFilePath(boardRoot, card.id);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, serializeCardMd(card), 'utf-8');
  fs.renameSync(tmp, target);
}

// No-op: in V3 cards live in their own folder and don't move on column change
export function moveCardFile(
  _boardRoot: string,
  _id: string,
  _fromColumn?: Column,
  _toColumn?: Column
): void {}

export function deleteCardFile(boardRoot: string, id: string, _column?: Column): void {
  const dir = getCardDir(boardRoot, id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Logging ───────────────────────────────────────────────────────────────────

export function appendCardLog(boardRoot: string, cardId: string, line: string): void {
  const dir = getCardDir(boardRoot, cardId);
  fs.mkdirSync(dir, { recursive: true });
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  fs.appendFileSync(getCardLogPath(boardRoot, cardId), entry, 'utf-8');
}

export function appendBoardLog(boardRoot: string, line: string): void {
  const logPath = path.join(boardRoot, 'board.log');
  const entry = `${new Date().toISOString()}  ${line}\n`;
  fs.appendFileSync(logPath, entry, 'utf-8');
}

// ── ID generation ─────────────────────────────────────────────────────────────

export function generateId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hex = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${date}-${hex}`;
}

// ── Board state ───────────────────────────────────────────────────────────────

export function loadBoardState(
  boardRoot: string,
  columnConfigs?: ColumnConfig[],
  tags?: Record<string, { color: string }>,
  hooks?: Record<string, { file: string }>
): { manifest: Manifest; cards: Record<string, Card | null> } {
  const manifest = readManifest(boardRoot, columnConfigs, tags, hooks);
  const cards: Record<string, Card | null> = {};
  for (const col of manifest.columns) {
    for (const id of col.cards) {
      if (!(id in cards)) {
        cards[id] = readCard(boardRoot, id);
      }
    }
  }
  return { manifest, cards };
}

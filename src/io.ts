import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as vscode from 'vscode';
import { Card, Manifest } from './types';

export function getBoardRoot(workspaceRoot: string): string {
  const folderName = vscode.workspace.getConfiguration('personal-kanban').get<string>('boardFolderName', '.personal-kanban');
  return path.join(workspaceRoot, folderName);
}

export function getManifestPath(boardRoot: string): string {
  return path.join(boardRoot, 'manifest.json');
}

function getCardsDir(boardRoot: string): string {
  const custom = vscode.workspace.getConfiguration('personal-kanban').get<string>('cardsFolderPath', '');
  if (custom) {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsRoot) return path.resolve(wsRoot, custom);
  }
  return path.join(boardRoot, 'cards');
}

function getArchiveDir(boardRoot: string): string {
  const custom = vscode.workspace.getConfiguration('personal-kanban').get<string>('archiveFolderPath', '');
  if (custom) {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsRoot) return path.resolve(wsRoot, custom);
  }
  return path.join(boardRoot, 'archive');
}

export function getCardPath(boardRoot: string, id: string): string {
  return path.join(getCardsDir(boardRoot), `${id}.md`);
}

export function getArchivePath(boardRoot: string, id: string): string {
  return path.join(getArchiveDir(boardRoot), `${id}.md`);
}

export function boardExists(boardRoot: string): boolean {
  return fs.existsSync(getManifestPath(boardRoot));
}

export function readManifest(boardRoot: string): Manifest {
  const raw = fs.readFileSync(getManifestPath(boardRoot), 'utf-8');
  const data = JSON.parse(raw);

  // Migrate v3 object-format columns → v4 Column[] array
  if (!Array.isArray(data.columns)) {
    const colOrder = ['backlog', 'refined', 'in-progress', 'review', 'done'];
    const colLabels: Record<string, string> = {
      backlog: 'Backlog', refined: 'Refined', 'in-progress': 'In Progress',
      review: 'Review', done: 'Done',
    };
    const colIds = Object.keys(data.columns as Record<string, string[]>);
    const ordered = [
      ...colOrder.filter(id => colIds.includes(id)),
      ...colIds.filter(id => !colOrder.includes(id)),
    ];
    data.columns = ordered.map((id: string, idx: number) => ({
      id,
      label: colLabels[id] ?? id,
      index: idx,
      wip_limit: null,
      policies: [],
    }));
    data.version = 1;
    if (!data.name) data.name = '';
    if (!data.scripts) data.scripts = {};
    if (!data.hooks) data.hooks = {};
  }

  // Migrate v4 (cards-in-columns) → v1 (cards-in-files)
  // v4 stored cards: string[] on each column; v1 derives card placement from card metadata.
  // Strip the persisted cards arrays — they will be re-populated by loadBoardState().
  if (data.version <= 4) {
    for (const col of data.columns) {
      // Preserve index ordering from array position if index field is absent
      if (typeof col.index !== 'number') {
        col.index = data.columns.indexOf(col);
      }
      // Migrate old object-shaped policies to string[] references
      if (!Array.isArray(col.policies)) col.policies = [];
      delete col.cards;
    }
    if (!data.policies) data.policies = {};
    if (!data.board_policies) data.board_policies = [];
    if (!data.policy_bypass_tags) data.policy_bypass_tags = [];
    // Migrate scripts/hooks from VSCode settings into manifest on first read
    if (!data.scripts || Object.keys(data.scripts).length === 0) {
      const cfg = vscode.workspace.getConfiguration('personal-kanban');
      data.scripts = cfg.get<Manifest['scripts']>('scripts', {});
    }
    if (!data.hooks || Object.keys(data.hooks).length === 0) {
      const cfg = vscode.workspace.getConfiguration('personal-kanban');
      data.hooks = cfg.get<Manifest['hooks']>('hooks', {});
    }
    data.version = 1;
  }

  // Tags, tagColorTarget, and showCardAge remain in VSCode settings (workspace-level config).
  const config = vscode.workspace.getConfiguration('personal-kanban');
  data.tags = config.get<Manifest['tags']>('tags', {});
  data.tagColorTarget = config.get<Manifest['tagColorTarget']>('tagColorTarget', 'tag');
  data.showCardAge = config.get<boolean>('showCardAge', true);

  return data as Manifest;
}

const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 3000;

function getLockPath(boardRoot: string): string {
  return path.join(boardRoot, 'manifest.lock');
}

export function withLock<T>(boardRoot: string, fn: () => T): T {
  const lockPath = getLockPath(boardRoot);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, process.pid.toString());
      fs.closeSync(fd);
      break;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') { throw e; }
      if (Date.now() >= deadline) {
        try {
          const pid = parseInt(fs.readFileSync(lockPath, 'utf-8'), 10);
          if (!isNaN(pid)) {
            try { process.kill(pid, 0); } catch {
              try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
              continue;
            }
          }
        } catch { /* ignore */ }
        throw new Error(`manifest.lock: could not acquire within ${LOCK_TIMEOUT_MS}ms`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
    }
  }

  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  }
}

/** Write content to tmp, fsync, then atomically rename to target. */
function atomicWrite(target: string, content: string): void {
  const tmp = target + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
  try {
    const dirFd = fs.openSync(path.dirname(target), fs.constants.O_RDONLY);
    try { fs.fsyncSync(dirFd); } catch { /* ignore */ }
    finally { try { fs.closeSync(dirFd); } catch { /* ignore */ } }
  } catch { /* ignore on Windows or unsupported FS */ }
}

export function writeManifest(boardRoot: string, manifest: Manifest): void {
  // Strip runtime-only fields: tags/tagColorTarget/showCardAge come from VSCode settings.
  // Strip in-memory cards arrays from columns — card placement is derived from card files.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tags, showCardAge, tagColorTarget, ...toWrite } = manifest;
  const columnsToWrite = toWrite.columns.map(({ cards: _cards, ...col }) => col);
  const data = { ...toWrite, columns: columnsToWrite };
  atomicWrite(getManifestPath(boardRoot), JSON.stringify(data, null, 2));
}

// ── Card I/O ────────────────────────────────────────────────────────────────

const KNOWN_CARD_KEYS = new Set([
  'id', 'created_at', 'column', 'order', 'active_at', 'done_at', 'branch', 'archived_at',
  'created_by', 'active_by', 'done_by', 'archived_by',
]);

function parseCardMd(raw: string, id: string): Card {
  const now = new Date().toISOString();
  // Normalise line endings so the regex works regardless of editor/OS/tool.
  const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const match = normalised.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { id, content: raw, metadata: { created_at: now } };
  }
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  const extra: Record<string, string> = {};
  for (const key of Object.keys(fm)) {
    if (!KNOWN_CARD_KEYS.has(key)) {
      extra[key] = fm[key];
    }
  }
  return {
    id,
    content: match[2].replace(/^\n/, ''),
    metadata: {
      created_at: fm.created_at ?? now,
      ...(fm.column     ? { column:      fm.column }      : {}),
      ...(fm.order      ? { order:       fm.order }       : {}),
      ...(fm.active_at  ? { active_at:   fm.active_at }   : {}),
      ...(fm.done_at    ? { done_at:     fm.done_at }     : {}),
      ...(fm.branch       ? { branch:       fm.branch }       : {}),
      ...(fm.archived_at  ? { archived_at:  fm.archived_at }  : {}),
      ...(fm.created_by   ? { created_by:   fm.created_by }   : {}),
      ...(fm.active_by    ? { active_by:    fm.active_by }    : {}),
      ...(fm.done_by      ? { done_by:      fm.done_by }      : {}),
      ...(fm.archived_by  ? { archived_by:  fm.archived_by }  : {}),
      ...extra,
    },
  };
}

function serializeCardMd(card: Card): string {
  const lines = [
    '---',
    `id: ${card.id}`,
    `created_at: ${card.metadata.created_at}`,
  ];
  if (card.metadata.column)      { lines.push(`column: ${card.metadata.column}`); }
  if (card.metadata.order)       { lines.push(`order: ${card.metadata.order}`); }
  if (card.metadata.active_at)   { lines.push(`active_at: ${card.metadata.active_at}`); }
  if (card.metadata.done_at)     { lines.push(`done_at: ${card.metadata.done_at}`); }
  if (card.metadata.branch)      { lines.push(`branch: ${card.metadata.branch}`); }
  if (card.metadata.archived_at) { lines.push(`archived_at: ${card.metadata.archived_at}`); }
  if (card.metadata.created_by)  { lines.push(`created_by: ${card.metadata.created_by}`); }
  if (card.metadata.active_by)   { lines.push(`active_by: ${card.metadata.active_by}`); }
  if (card.metadata.done_by)     { lines.push(`done_by: ${card.metadata.done_by}`); }
  if (card.metadata.archived_by) { lines.push(`archived_by: ${card.metadata.archived_by}`); }

  for (const [key, value] of Object.entries(card.metadata)) {
    if (!KNOWN_CARD_KEYS.has(key) && value !== undefined) {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---', '');
  lines.push(card.content);
  return lines.join('\n');
}

export function readCard(boardRoot: string, id: string): Card | null {
  const mdPath = getCardPath(boardRoot, id);
  if (fs.existsSync(mdPath)) {
    return parseCardMd(fs.readFileSync(mdPath, 'utf-8'), id);
  }
  const archivePath = getArchivePath(boardRoot, id);
  if (fs.existsSync(archivePath)) {
    return parseCardMd(fs.readFileSync(archivePath, 'utf-8'), id);
  }
  // Legacy: card in cards/{id}/{id}.md subdirectory
  const legacyDirPath = path.join(getCardsDir(boardRoot), id, `${id}.md`);
  if (fs.existsSync(legacyDirPath)) {
    return parseCardMd(fs.readFileSync(legacyDirPath, 'utf-8'), id);
  }
  // Legacy: .json format
  const jsonPath = path.join(getCardsDir(boardRoot), `${id}.json`);
  if (fs.existsSync(jsonPath)) {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Card;
  }
  return null;
}

export function writeCard(boardRoot: string, card: Card): void {
  const folder = getCardsDir(boardRoot);
  fs.mkdirSync(folder, { recursive: true });
  atomicWrite(path.join(folder, `${card.id}.md`), serializeCardMd(card));
  const jsonPath = path.join(folder, `${card.id}.json`);
  if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
}

export function getGitUser(): string | null {
  try {
    const name  = execSync('git config user.name',  { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    const email = execSync('git config user.email', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (name && email) return `${name} <${email}>`;
    if (name)          return name;
    if (email)         return `<${email}>`;
  } catch {
    // git not available or user not configured
  }
  return null;
}

export function archiveCardFile(boardRoot: string, id: string): void {
  const src = getCardPath(boardRoot, id);
  const dst = getArchivePath(boardRoot, id);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(src)) {
    fs.renameSync(src, dst);
  }
}

export function deleteCardFile(boardRoot: string, id: string): void {
  const mdPath = getCardPath(boardRoot, id);
  if (fs.existsSync(mdPath)) fs.unlinkSync(mdPath);
  const archivePath = getArchivePath(boardRoot, id);
  if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
  const jsonPath = path.join(getCardsDir(boardRoot), `${id}.json`);
  if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
}

export function generateId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hex = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${date}-${hex}`;
}

// ── Midpoint ordering ────────────────────────────────────────────────────────
//
// Cards within a column are ordered by a decimal `order` value in [0, 1).
// Lower value = higher position (top of column). Boundaries are:
//   - 0  (exclusive lower bound — nothing goes above 0)
//   - 1  (exclusive upper bound — nothing goes at or above 1)
//
// Inserting at a position uses the midpoint formula:
//   newOrder = (prevOrder + nextOrder) / 2
//
// Where:
//   - prevOrder = order of the card above the insertion point (or 0 if inserting at top)
//   - nextOrder = order of the card below the insertion point (or 1 if inserting at bottom)
//
// Examples:
//   Empty column, first card:             (0 + 1) / 2 = 0.5
//   Second card after first (0.5):        (0.5 + 1) / 2 = 0.75
//   Third card between 0.5 and 0.75:      (0.5 + 0.75) / 2 = 0.625
//
// Only the moved/added card's `order` field is ever written — no other cards change.
// This is the fractional indexing / midpoint ordering pattern.
//
// Precision: JavaScript doubles give ~15 significant digits, so midpoint subdivision
// can be repeated ~50 times before values collapse. In practice this is not a concern.

export function calcOrder(prevOrder: number, nextOrder: number): number {
  return (prevOrder + nextOrder) / 2;
}

// ── Board state ──────────────────────────────────────────────────────────────

export function loadBoardState(boardRoot: string): {
  manifest: Manifest;
  cards: Record<string, Card | null>;
} {
  const manifest = readManifest(boardRoot);
  const cards: Record<string, Card | null> = {};

  // Scan all .md files in cards/ — card column membership comes from card metadata.
  const cardsDir = getCardsDir(boardRoot);
  if (fs.existsSync(cardsDir)) {
    for (const file of fs.readdirSync(cardsDir)) {
      if (!file.endsWith('.md')) continue;
      const id = file.slice(0, -3);
      cards[id] = parseCardMd(fs.readFileSync(path.join(cardsDir, file), 'utf-8'), id);
    }
  }

  // Default column: first column in manifest (fallback when a card has no `column` field).
  const defaultColumnId = manifest.columns[0]?.id ?? 'backlog';

  // Build per-column card lists, sorted by `order` ascending (lower = top).
  // Cards without an `order` field fall back to `created_at` for sorting.
  const columnBuckets: Record<string, { id: string; sortKey: number }[]> = {};
  for (const col of manifest.columns) {
    columnBuckets[col.id] = [];
  }

  for (const [id, card] of Object.entries(cards)) {
    if (!card) continue;
    const colId = card.metadata.column ?? defaultColumnId;
    // Exact match first; case-insensitive fallback handles e.g. 'Done' vs 'done'.
    const targetId = columnBuckets[colId] !== undefined
      ? colId
      : (Object.keys(columnBuckets).find(k => k.toLowerCase() === colId.toLowerCase()) ?? defaultColumnId);
    columnBuckets[targetId].push({ id, sortKey: toSortKey(card) });
  }

  // Attach sorted card ID arrays onto each column (in-memory only; not written to manifest).
  for (const col of manifest.columns) {
    const bucket = columnBuckets[col.id] ?? [];
    bucket.sort((a, b) => a.sortKey - b.sortKey);
    col.cards = bucket.map(e => e.id);
  }

  return { manifest, cards };
}

/** Convert a card's order/created_at to a numeric sort key. */
function toSortKey(card: Card): number {
  if (card.metadata.order) {
    const n = parseFloat(card.metadata.order);
    if (!isNaN(n)) return n;
  }
  // Fall back to created_at timestamp for cards that predate the order field.
  return new Date(card.metadata.created_at).getTime();
}

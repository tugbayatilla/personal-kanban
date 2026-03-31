import * as fs from 'fs';
import * as path from 'path';
import { Card, Manifest } from './types';

export function getBoardRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.personal-kanban');
}

export function getManifestPath(boardRoot: string): string {
  return path.join(boardRoot, 'manifest.json');
}

export function getCardPath(boardRoot: string, id: string): string {
  return path.join(boardRoot, 'cards', `${id}.md`);
}

export function getArchivePath(boardRoot: string, id: string): string {
  return path.join(boardRoot, 'archive', `${id}.md`);
}

export function boardExists(boardRoot: string): boolean {
  return fs.existsSync(getManifestPath(boardRoot));
}

export function readManifest(boardRoot: string): Manifest {
  const raw = fs.readFileSync(getManifestPath(boardRoot), 'utf-8');
  const data = JSON.parse(raw);
  // Migrate v3 object-format columns to v4 Column[] array
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
    data.columns = ordered.map((id: string) => ({
      id,
      label: colLabels[id] ?? id,
      wip_limit: null,
      cards: (data.columns as Record<string, string[]>)[id] ?? [],
    }));
    data.version = 4;
    if (!data.name) data.name = '';
    if (!data.tags) data.tags = {};
    if (!data.scripts) data.scripts = {};
    if (!data.hooks) data.hooks = {};
  }
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

  while (true) {
    try {
      // O_EXCL: fails atomically if lock file already exists
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, process.pid.toString());
      fs.closeSync(fd);
      break; // lock acquired
    } catch (e: any) {
      if (e.code !== 'EEXIST') { throw e; }
      if (Date.now() >= deadline) {
        // Check for stale lock (dead process)
        try {
          const pid = parseInt(fs.readFileSync(lockPath, 'utf-8'), 10);
          if (!isNaN(pid)) {
            try { process.kill(pid, 0); } catch {
              // Process is dead — remove stale lock and retry
              try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
              continue;
            }
          }
        } catch { /* ignore */ }
        throw new Error(`manifest.lock: could not acquire within ${LOCK_TIMEOUT_MS}ms`);
      }
      // Spin-wait before retrying
      const until = Date.now() + LOCK_RETRY_MS;
      while (Date.now() < until) { /* spin */ }
    }
  }

  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  }
}

export function writeManifest(boardRoot: string, manifest: Manifest): void {
  const target = getManifestPath(boardRoot);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(tmp, target);
}

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

export function readCard(boardRoot: string, id: string): Card | null {
  // Active cards
  const mdPath = getCardPath(boardRoot, id);
  if (fs.existsSync(mdPath)) {
    return parseCardMd(fs.readFileSync(mdPath, 'utf-8'), id);
  }
  // Archived cards
  const archivePath = getArchivePath(boardRoot, id);
  if (fs.existsSync(archivePath)) {
    return parseCardMd(fs.readFileSync(archivePath, 'utf-8'), id);
  }
  // Legacy: card stored in cards/{id}/{id}.md subdirectory
  const legacyDirPath = path.join(boardRoot, 'cards', id, `${id}.md`);
  if (fs.existsSync(legacyDirPath)) {
    return parseCardMd(fs.readFileSync(legacyDirPath, 'utf-8'), id);
  }
  // Legacy: .json format
  const jsonPath = path.join(boardRoot, 'cards', `${id}.json`);
  if (fs.existsSync(jsonPath)) {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Card;
  }
  return null;
}

export function writeCard(boardRoot: string, card: Card): void {
  card.metadata.updated_at = new Date().toISOString();
  const folder = path.join(boardRoot, 'cards');
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, `${card.id}.md`);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, serializeCardMd(card), 'utf-8');
  fs.renameSync(tmp, target);
  // Remove legacy .json file if it exists
  const jsonPath = path.join(boardRoot, 'cards', `${card.id}.json`);
  if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
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
  const jsonPath = path.join(boardRoot, 'cards', `${id}.json`);
  if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
}

export function generateId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hex = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${date}-${hex}`;
}

export function loadBoardState(boardRoot: string): {
  manifest: Manifest;
  cards: Record<string, Card | null>;
} {
  const manifest = readManifest(boardRoot);
  const cards: Record<string, Card | null> = {};
  for (const col of manifest.columns) {
    for (const id of col.cards ?? []) {
      if (!(id in cards)) {
        cards[id] = readCard(boardRoot, id);
      }
    }
  }
  return { manifest, cards };
}

import * as fs from 'fs';
import * as path from 'path';
import { Card, Column, Manifest } from './types';

export function getBoardRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.personal-kanban');
}

export function getManifestPath(boardRoot: string): string {
  return path.join(boardRoot, 'manifest.json');
}

export function resolveCardsFolder(boardRoot: string, column?: Column): string {
  if (column?.folder) {
    return path.join(boardRoot, column.folder);
  }
  return path.join(boardRoot, 'cards');
}

export function getCardPath(boardRoot: string, id: string, column?: Column): string {
  return path.join(resolveCardsFolder(boardRoot, column), `${id}.md`);
}

export function boardExists(boardRoot: string): boolean {
  return fs.existsSync(getManifestPath(boardRoot));
}

export function readManifest(boardRoot: string): Manifest {
  const raw = fs.readFileSync(getManifestPath(boardRoot), 'utf-8');
  return JSON.parse(raw) as Manifest;
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
    // No frontmatter — treat entire file as content
    return { id, content: raw, metadata: { created_at: now, updated_at: now } };
  }
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return {
    id, // filename is source of truth
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

export function readCard(boardRoot: string, id: string, manifest?: Manifest): Card | null {
  // Try column-specific folder if manifest provided
  if (manifest) {
    const col = manifest.columns.find((c) => c.cards.includes(id));
    if (col?.folder) {
      const colPath = path.join(boardRoot, col.folder, `${id}.md`);
      if (fs.existsSync(colPath)) {
        return parseCardMd(fs.readFileSync(colPath, 'utf-8'), id);
      }
    }
  }
  // Default: flat cards/ folder (.md)
  const mdPath = path.join(boardRoot, 'cards', `${id}.md`);
  if (fs.existsSync(mdPath)) {
    return parseCardMd(fs.readFileSync(mdPath, 'utf-8'), id);
  }
  // Fallback: legacy .json format
  const jsonPath = path.join(boardRoot, 'cards', `${id}.json`);
  if (!fs.existsSync(jsonPath)) return null;
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  return JSON.parse(raw) as Card;
}

export function writeCard(boardRoot: string, card: Card, column?: Column): void {
  card.metadata.updated_at = new Date().toISOString();
  const folder = resolveCardsFolder(boardRoot, column);
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, `${card.id}.md`);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, serializeCardMd(card), 'utf-8');
  fs.renameSync(tmp, target);
  // Remove legacy .json file if it exists
  const jsonPath = path.join(boardRoot, 'cards', `${card.id}.json`);
  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
  }
}

export function moveCardFile(boardRoot: string, id: string, fromColumn?: Column, toColumn?: Column): void {
  const srcFolder = resolveCardsFolder(boardRoot, fromColumn);
  const dstFolder = resolveCardsFolder(boardRoot, toColumn);
  if (srcFolder === dstFolder) return;
  const srcPath = path.join(srcFolder, `${id}.md`);
  if (!fs.existsSync(srcPath)) return;
  fs.mkdirSync(dstFolder, { recursive: true });
  fs.renameSync(srcPath, path.join(dstFolder, `${id}.md`));
}

export function appendCardLog(boardRoot: string, cardId: string, line: string): void {
  const logPath = path.join(boardRoot, 'logs', 'cards', `${cardId}.log`);
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  fs.appendFileSync(logPath, entry, 'utf-8');
}

export function deleteCardFile(boardRoot: string, id: string, column?: Column): void {
  const folder = resolveCardsFolder(boardRoot, column);
  const mdPath = path.join(folder, `${id}.md`);
  if (fs.existsSync(mdPath)) fs.unlinkSync(mdPath);
  // Also clean up flat folder if using a column-specific folder
  if (column?.folder) {
    const flatMdPath = path.join(boardRoot, 'cards', `${id}.md`);
    if (fs.existsSync(flatMdPath)) fs.unlinkSync(flatMdPath);
  }
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
        cards[id] = readCard(boardRoot, id, manifest);
      }
    }
  }
  return { manifest, cards };
}

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

export function readCard(boardRoot: string, id: string): Card | null {
  const mdPath = getCardPath(boardRoot, id);
  if (fs.existsSync(mdPath)) {
    const raw = fs.readFileSync(mdPath, 'utf-8');
    return parseCardMd(raw, id);
  }
  // Fallback: read legacy .json format
  const jsonPath = path.join(boardRoot, 'cards', `${id}.json`);
  if (!fs.existsSync(jsonPath)) return null;
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  return JSON.parse(raw) as Card;
}

export function writeCard(boardRoot: string, card: Card): void {
  card.metadata.updated_at = new Date().toISOString();
  const target = getCardPath(boardRoot, card.id);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, serializeCardMd(card), 'utf-8');
  fs.renameSync(tmp, target);
  // Remove legacy .json file if it exists
  const jsonPath = path.join(boardRoot, 'cards', `${card.id}.json`);
  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
  }
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

export function deleteCardFile(boardRoot: string, id: string): void {
  const mdPath = getCardPath(boardRoot, id);
  if (fs.existsSync(mdPath)) fs.unlinkSync(mdPath);
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

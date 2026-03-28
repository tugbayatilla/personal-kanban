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
  return path.join(boardRoot, 'cards', `${id}.json`);
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

export function readCard(boardRoot: string, id: string): Card | null {
  const cardPath = getCardPath(boardRoot, id);
  if (!fs.existsSync(cardPath)) return null;
  const raw = fs.readFileSync(cardPath, 'utf-8');
  return JSON.parse(raw) as Card;
}

export function writeCard(boardRoot: string, card: Card): void {
  card.metadata.updated_at = new Date().toISOString();
  const target = getCardPath(boardRoot, card.id);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(card, null, 2), 'utf-8');
  fs.renameSync(tmp, target);
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
  const cardPath = getCardPath(boardRoot, id);
  if (fs.existsSync(cardPath)) {
    fs.unlinkSync(cardPath);
  }
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

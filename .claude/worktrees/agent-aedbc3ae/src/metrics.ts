/**
 * Shared metrics computation used by MetricsPanel and the exportMetrics command.
 *
 * Keeps card loading and all numeric analysis in one place so the webview
 * frontend (metrics.js) and the JSON export produce identical numbers.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CardSummary {
  id: string;
  tags: string[];
  created_at: string;
  active_at?: string;
  done_at?: string;
  archived_at?: string;
  column?: string;
}

export interface TimeStat {
  count: number;
  avg_ms: number | null;
  median_ms: number | null;
  avg_human: string;
  median_human: string;
}

export interface BucketEntry {
  bucket: string;
  count: number;
}

export interface WeekEntry {
  week_start: string;   // ISO date string of the Monday that opens the week
  count: number;
}

export interface ColumnSnapshot {
  column_id: string;
  label: string;
  count: number;
  avg_age_ms: number | null;
  avg_age_human: string;
}

export interface CardRecord extends CardSummary {
  cycle_time_ms?: number;
  cycle_time_human?: string;
  lead_time_ms?: number;
  lead_time_human?: string;
}

export interface MetricsData {
  generated_at: string;
  summary: {
    total_completed: number;
    total_active: number;
    cycle_time: TimeStat;
    lead_time: TimeStat;
    throughput: { last_4_weeks: number; per_week_avg: number };
  };
  weekly_throughput: WeekEntry[];
  cycle_time_distribution: BucketEntry[];
  lead_time_distribution: BucketEntry[];
  board_snapshot: ColumnSnapshot[];
  cards: CardRecord[];
}

// ── Card loading ─────────────────────────────────────────────────────────────

export function loadAllCardFiles(boardRoot: string): CardSummary[] {
  const cfg = vscode.workspace.getConfiguration('personal-kanban');
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const customCards = cfg.get<string>('cardsFolderPath', '');
  const cardsDir = customCards && wsRoot
    ? path.resolve(wsRoot, customCards)
    : path.join(boardRoot, 'cards');

  const customArchive = cfg.get<string>('archiveFolderPath', '');
  const archiveDir = customArchive && wsRoot
    ? path.resolve(wsRoot, customArchive)
    : path.join(boardRoot, 'archive');

  const cards: CardSummary[] = [];
  for (const dir of [cardsDir, archiveDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const id = file.slice(0, -3);
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
        const card = parseCard(id, raw);
        if (card) cards.push(card);
      } catch { /* skip unreadable */ }
    }
  }
  return cards;
}

function parseCard(id: string, raw: string): CardSummary | null {
  const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const match = normalised.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }

  const tags = (match[2].match(/#(\w+)/g) ?? []).map((t) => t.slice(1));

  return {
    id,
    tags,
    created_at:   fm.created_at ?? new Date().toISOString(),
    active_at:    fm.active_at    || undefined,
    done_at:      fm.done_at      || undefined,
    archived_at:  fm.archived_at  || undefined,
    column:       fm.column       || undefined,
  };
}

// ── Computation ───────────────────────────────────────────────────────────────

export function computeMetrics(
  cards: CardSummary[],
  columns: Array<{ id: string; label: string }>,
  now: Date = new Date()
): MetricsData {
  const nowMs = now.getTime();
  const completed = cards.filter((c) => !!c.done_at);
  const active    = cards.filter((c) => !c.done_at && !c.archived_at);

  // ── Cycle time (active_at → done_at) ──────────────────────────────────────
  const cycleMsList = completed
    .filter((c) => c.active_at)
    .map((c) => new Date(c.done_at!).getTime() - new Date(c.active_at!).getTime());

  // ── Lead time (created_at → done_at) ─────────────────────────────────────
  const leadMsList = completed
    .map((c) => new Date(c.done_at!).getTime() - new Date(c.created_at).getTime());

  // ── Throughput last 4 weeks ───────────────────────────────────────────────
  const fourWeeksAgo = nowMs - 28 * 86400000;
  const last4wk = completed.filter((c) => new Date(c.done_at!).getTime() >= fourWeeksAgo).length;

  // ── Card records (enriched) ───────────────────────────────────────────────
  const cardRecords: CardRecord[] = cards.map((c) => {
    const rec: CardRecord = { ...c };
    if (c.done_at) {
      if (c.active_at) {
        const ms = new Date(c.done_at).getTime() - new Date(c.active_at).getTime();
        rec.cycle_time_ms    = ms;
        rec.cycle_time_human = formatDuration(ms);
      }
      const lms = new Date(c.done_at).getTime() - new Date(c.created_at).getTime();
      rec.lead_time_ms    = lms;
      rec.lead_time_human = formatDuration(lms);
    }
    return rec;
  });

  return {
    generated_at: now.toISOString(),
    summary: {
      total_completed: completed.length,
      total_active:    active.length,
      cycle_time: timeStat(cycleMsList),
      lead_time:  timeStat(leadMsList),
      throughput: { last_4_weeks: last4wk, per_week_avg: last4wk / 4 },
    },
    weekly_throughput:      weeklyThroughput(completed, 12, now),
    cycle_time_distribution: distributeTimes(cycleMsList),
    lead_time_distribution:  distributeTimes(leadMsList),
    board_snapshot:          boardSnapshot(active, columns, nowMs),
    cards: cardRecords,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function timeStat(msList: number[]): TimeStat {
  if (msList.length === 0) {
    return { count: 0, avg_ms: null, median_ms: null, avg_human: '—', median_human: '—' };
  }
  const avg = mean(msList);
  const med = median(msList);
  return {
    count:        msList.length,
    avg_ms:       avg,
    median_ms:    med,
    avg_human:    formatDuration(avg),
    median_human: formatDuration(med),
  };
}

function weeklyThroughput(completed: CardSummary[], numWeeks: number, now: Date): WeekEntry[] {
  const weekStart = mondayOf(now);
  const result: WeekEntry[] = [];

  for (let i = numWeeks - 1; i >= 0; i--) {
    const start = new Date(weekStart.getTime() - i * 7 * 86400000);
    const end   = new Date(start.getTime() + 7 * 86400000);
    const count = completed.filter((c) => {
      const t = new Date(c.done_at!).getTime();
      return t >= start.getTime() && t < end.getTime();
    }).length;
    result.push({ week_start: start.toISOString().slice(0, 10), count });
  }

  return result;
}

const TIME_BUCKETS: Array<{ bucket: string; maxMs: number }> = [
  { bucket: '<1d',   maxMs: 86400000 },
  { bucket: '1-3d',  maxMs: 3 * 86400000 },
  { bucket: '3-7d',  maxMs: 7 * 86400000 },
  { bucket: '1-2wk', maxMs: 14 * 86400000 },
  { bucket: '2-4wk', maxMs: 28 * 86400000 },
  { bucket: '>4wk',  maxMs: Infinity },
];

function distributeTimes(msList: number[]): BucketEntry[] {
  const counts = new Array<number>(TIME_BUCKETS.length).fill(0);
  for (const ms of msList) {
    const idx = TIME_BUCKETS.findIndex((b) => ms < b.maxMs);
    if (idx !== -1) counts[idx]++;
  }
  return TIME_BUCKETS.map((b, i) => ({ bucket: b.bucket, count: counts[i] }));
}

function boardSnapshot(
  active: CardSummary[],
  columns: Array<{ id: string; label: string }>,
  nowMs: number
): ColumnSnapshot[] {
  return columns.map((col) => {
    const colCards = active.filter((c) => c.column === col.id);
    const ages = colCards.map((c) => nowMs - new Date(c.created_at).getTime());
    const avg  = ages.length ? mean(ages) : null;
    return {
      column_id:     col.id,
      label:         col.label,
      count:         colCards.length,
      avg_age_ms:    avg,
      avg_age_human: avg !== null ? formatDuration(avg) : '—',
    };
  });
}

function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr: number[]): number {
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

export function formatDuration(ms: number): string {
  if (ms < 0) return '0m';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60)  return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  if (hours < 24)    return hours + 'h';
  const days = Math.floor(hours / 24);
  if (days < 7)      return days + 'd';
  const weeks = Math.floor(days / 7);
  if (weeks < 8)     return weeks + 'wk';
  return Math.floor(days / 30) + 'mo';
}

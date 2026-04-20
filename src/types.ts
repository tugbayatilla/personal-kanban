export interface PolicyDefinition {
  description: string;
  message: string;
  script?: string;
}

export interface Column {
  id: string;
  label: string;
  index: number;
  wip_limit: number | null;
  policies: string[];
  // In-memory only: assembled from card files on load, not stored in manifest.json
  cards?: string[];
}

export interface Script {
  file: string;
}

export interface ColumnStamps {
  /** Column id that triggers active_at stamping (first move only). */
  active_at?: string;
  /** Column id that triggers done_at stamping (every move). */
  done_at?: string;
}

export interface Manifest {
  version: number;
  name: string;
  columns: Column[];
  policies?: Record<string, PolicyDefinition>;
  board_policies?: string[];
  policy_bypass_tags?: string[];
  /** Maps metadata timestamp fields to the column id that triggers them. */
  column_stamps?: ColumnStamps;
  tags: Record<string, { color: string; weight: number }>;
  scripts: Record<string, Script>;
  hooks: Record<string, string[]>;
  tagColorTarget: 'tag' | 'card-border' | 'card-background';
  showCardAge?: boolean;
}

export interface CardMetadata {
  id?: string;
  created_at: string;
  column?: string;       // Which column this card belongs to (default: first column / backlog)
  order?: string;        // Sort order within column (ISO timestamp; lower = earlier)
  active_at?: string;
  done_at?: string;
  branch?: string;
  archived_at?: string;
  [key: string]: string | undefined;
}

export interface Card {
  id: string;
  content: string;
  metadata: CardMetadata;
}

// Messages from webview → extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'addCard'; columnId: string }
  | { type: 'saveCard'; id: string; content: string }
  | { type: 'deleteCard'; id: string }
  | { type: 'moveCard'; id: string; fromColumn: string; toColumn: string; toIndex: number }
  | { type: 'archiveDone' }
  | { type: 'openCardFile'; id: string }
  | { type: 'openManifestFile' };

// Messages from extension → webview
export type ExtensionMessage =
  | { type: 'setState'; manifest: Manifest; cards: Record<string, Card | null> }
  | { type: 'setState'; manifest: null; cards: Record<string, never>; error: string };

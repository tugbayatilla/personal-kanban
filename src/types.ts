export interface Column {
  id: string;
  label: string;
  wip_limit: number | null;
  cards: string[];
}

export interface Script {
  file: string;
}

export interface Manifest {
  version: number;
  name: string;
  columns: Column[];
  tags: Record<string, { color: string; weight: number }>;
  scripts: Record<string, Script>;
  hooks: Record<string, string[]>;
}

export interface CardMetadata {
  created_at: string;
  updated_at: string;
  branch?: string;
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
  | { type: 'moveCard'; id: string; fromColumn: string; toColumn: string; toIndex: number };

// Messages from extension → webview
export type ExtensionMessage =
  | { type: 'setState'; manifest: Manifest; cards: Record<string, Card | null> }
  | { type: 'setState'; manifest: null; cards: Record<string, never>; error: string };

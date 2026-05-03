import { Router } from 'express';
import {
  readManifest,
  loadBoardState,
  archiveCardFile,
  fireHook,
} from '@personal-kanban/core';
import { consoleLogger } from '../logger';

export function createArchiveRouter(boardRoot: string): Router {
  const router = Router();

  // POST /api/archive — archive all Done column cards
  router.post('/archive', (_req, res) => {
    try {
      const manifest = readManifest(boardRoot);
      const doneColId = manifest.column_stamps?.done_at ?? 'done';
      const state = loadBoardState(boardRoot);

      const doneCol = state.manifest.columns.find(c => c.id === doneColId);
      const doneCardIds = doneCol?.cards ?? [];

      if (doneCardIds.length === 0) {
        res.json({ archived: [] });
        return;
      }

      for (const cardId of doneCardIds) {
        archiveCardFile(boardRoot, cardId);
      }

      fireHook(boardRoot, manifest, 'cards.archived', { column: doneColId, card_ids: doneCardIds }, consoleLogger);

      res.json({ archived: doneCardIds });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}

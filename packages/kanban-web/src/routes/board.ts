import { Router } from 'express';
import { loadBoardState } from '@personal-kanban/core';

export function createBoardRouter(boardRoot: string): Router {
  const router = Router();

  router.get('/board', (_req, res) => {
    try {
      const { manifest, cards } = loadBoardState(boardRoot);
      res.json({ manifest, cards });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}

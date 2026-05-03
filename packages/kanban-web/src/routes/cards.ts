import { Router } from 'express';
import {
  readManifest,
  readCard,
  writeCard,
  deleteCardFile,
  generateId,
  calcOrder,
  loadBoardState,
  fireHook,
  runPolicyScript,
} from '@personal-kanban/core';
import type { Card } from '@personal-kanban/core';
import { consoleLogger } from '../logger';

export function createCardsRouter(boardRoot: string): Router {
  const router = Router();

  // POST /api/cards — create a new card
  router.post('/cards', (req, res) => {
    try {
      const { columnId, title } = req.body as { columnId: string; title: string };
      if (!columnId) {
        res.status(400).json({ error: 'columnId is required' });
        return;
      }

      const manifest = readManifest(boardRoot);
      const col = manifest.columns.find(c => c.id === columnId);
      if (!col) {
        res.status(404).json({ error: `Column '${columnId}' not found` });
        return;
      }

      const order = calcOrder(0, 1);
      const id = generateId();
      const now = new Date().toISOString();
      const cardTitle = title || '';
      const card: Card = {
        id,
        content: cardTitle ? `# ${cardTitle}\n` : '',
        metadata: {
          created_at: now,
          column: columnId,
          order: String(order),
        },
      };

      writeCard(boardRoot, card);
      fireHook(boardRoot, manifest, 'card.created', { card_id: id, column: columnId }, consoleLogger);

      res.status(201).json(card);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  // PATCH /api/cards/:id — update card content
  router.patch('/cards/:id', (req, res) => {
    try {
      const { id } = req.params;
      const { content } = req.body as { content: string };

      const card = readCard(boardRoot, id);
      if (!card) {
        res.status(404).json({ error: `Card '${id}' not found` });
        return;
      }

      const updatedCard: Card = {
        ...card,
        content: content ?? card.content,
      };

      writeCard(boardRoot, updatedCard);
      res.json(updatedCard);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  // PATCH /api/cards/:id/move — move a card to a different column
  router.patch('/cards/:id/move', async (req, res) => {
    try {
      const { id } = req.params;
      const { toColumn, fromColumn, toIndex } = req.body as {
        toColumn: string;
        fromColumn?: string;
        toIndex?: number;
      };

      if (!toColumn) {
        res.status(400).json({ error: 'toColumn is required' });
        return;
      }

      const manifest = readManifest(boardRoot);
      const toCol = manifest.columns.find(c => c.id === toColumn);
      if (!toCol) {
        res.status(404).json({ error: `Column '${toColumn}' not found` });
        return;
      }

      const card = readCard(boardRoot, id);
      if (!card) {
        res.status(404).json({ error: `Card '${id}' not found` });
        return;
      }

      const fromColumnId = fromColumn ?? card.metadata.column ?? manifest.columns[0]?.id ?? 'backlog';

      // Run board-level and column-entry policies
      for (const policyId of [...(manifest.board_policies ?? []), ...(toCol.policies ?? [])]) {
        const policy = manifest.policies?.[policyId];
        if (!policy?.script) continue;
        const payload = { card_id: id, from_column: fromColumnId, to_column: toColumn };
        const violated = await runPolicyScript(boardRoot, policy.script, payload, consoleLogger);
        if (violated) {
          res.status(409).json({ error: policy.message });
          return;
        }
      }

      // Calculate new order based on toIndex
      let newOrder: number;
      if (toIndex !== undefined) {
        const state = loadBoardState(boardRoot);
        const colCards = state.manifest.columns.find(c => c.id === toColumn)?.cards ?? [];
        // Filter out the card being moved
        const otherCards = colCards.filter(cid => cid !== id);

        const prevId = toIndex > 0 ? otherCards[toIndex - 1] : undefined;
        const nextId = otherCards[toIndex];

        const prevOrder = prevId ? parseFloat(state.cards[prevId]?.metadata.order ?? '0') || 0 : 0;
        const nextOrder = nextId ? parseFloat(state.cards[nextId]?.metadata.order ?? '1') || 1 : 1;
        newOrder = calcOrder(prevOrder, nextOrder);
      } else {
        newOrder = calcOrder(0, 1);
      }

      const now = new Date().toISOString();
      const newMetadata = {
        ...card.metadata,
        column: toColumn,
        order: String(newOrder),
        ...(manifest.column_stamps?.active_at === toColumn && !card.metadata.active_at ? { active_at: now } : {}),
        ...(manifest.column_stamps?.done_at === toColumn ? { done_at: now } : {}),
      };

      const updatedCard: Card = { ...card, metadata: newMetadata };
      writeCard(boardRoot, updatedCard);
      fireHook(boardRoot, manifest, 'card.moved', { card_id: id, from_column: fromColumnId, to_column: toColumn }, consoleLogger);

      res.json(updatedCard);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  // DELETE /api/cards/:id — delete a card
  router.delete('/cards/:id', (req, res) => {
    try {
      const { id } = req.params;

      const card = readCard(boardRoot, id);
      if (!card) {
        res.status(404).json({ error: `Card '${id}' not found` });
        return;
      }

      const manifest = readManifest(boardRoot);
      deleteCardFile(boardRoot, id);
      fireHook(boardRoot, manifest, 'card.deleted', { card_id: id }, consoleLogger);

      res.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}

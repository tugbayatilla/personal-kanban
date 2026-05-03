import { Command } from 'commander';
import { getBoardRoot, readManifest, readCard, writeCard, fireHook } from '@personal-kanban/core';
import { consoleLogger } from '../logger';

export function registerDone(program: Command): void {
  program
    .command('done <cardId>')
    .description('Move a card to the Done column')
    .option('--json', 'Output as JSON')
    .action((cardId: string, opts) => {
      try {
        const boardRoot = getBoardRoot(process.cwd());
        const manifest = readManifest(boardRoot);
        const doneColId = manifest.column_stamps?.done_at ?? 'done';
        const card = readCard(boardRoot, cardId);
        if (!card) {
          console.error(`Card '${cardId}' not found`);
          process.exit(1);
        }
        const fromColumnId = card.metadata.column ?? manifest.columns[0]?.id ?? 'backlog';
        const now = new Date().toISOString();
        const updatedCard = {
          ...card,
          metadata: {
            ...card.metadata,
            column: doneColId,
            done_at: now
          }
        };
        writeCard(boardRoot, updatedCard);
        fireHook(boardRoot, manifest, 'card.moved', { card_id: cardId, from_column: fromColumnId, to_column: doneColId }, consoleLogger);
        if (opts.json) {
          console.log(JSON.stringify(updatedCard, null, 2));
        } else {
          console.log(`Card ${cardId} marked as done`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Error: ' + msg);
        process.exit(1);
      }
    });
}

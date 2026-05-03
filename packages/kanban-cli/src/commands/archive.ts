import { Command } from 'commander';
import { getBoardRoot, readManifest, loadBoardState, archiveCardFile, fireHook } from '@personal-kanban/core';
import { consoleLogger } from '../logger';

export function registerArchive(program: Command): void {
  program
    .command('archive')
    .description('Archive all cards in the Done column')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      try {
        const boardRoot = getBoardRoot(process.cwd());
        const manifest = readManifest(boardRoot);
        const doneColId = manifest.column_stamps?.done_at ?? 'done';
        const state = loadBoardState(boardRoot);

        // Get the done column from the state to find its card IDs
        const doneCol = state.manifest.columns.find(c => c.id === doneColId);
        const doneCardIds = doneCol?.cards ?? [];

        if (doneCardIds.length === 0) {
          console.log('No cards to archive');
          return;
        }

        for (const cardId of doneCardIds) {
          archiveCardFile(boardRoot, cardId);
        }

        fireHook(boardRoot, manifest, 'cards.archived', { column: doneColId, card_ids: doneCardIds }, consoleLogger);

        if (opts.json) {
          console.log(JSON.stringify({ archived: doneCardIds }));
        } else {
          console.log(`Archived ${doneCardIds.length} card(s)`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Error: ' + msg);
        process.exit(1);
      }
    });
}

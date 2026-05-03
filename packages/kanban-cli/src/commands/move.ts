import { Command } from 'commander';
import { getBoardRoot, readManifest, readCard, writeCard, fireHook, runPolicyScript } from '@personal-kanban/core';
import { consoleLogger } from '../logger';

export function registerMove(program: Command): void {
  program
    .command('move <cardId> <columnId>')
    .description('Move a card to a column')
    .option('--force', 'Bypass policy checks')
    .option('--json', 'Output as JSON')
    .action(async (cardId: string, columnId: string, opts) => {
      try {
        const boardRoot = getBoardRoot(process.cwd());
        const manifest = readManifest(boardRoot);
        const toCol = manifest.columns.find(c => c.id === columnId);
        if (!toCol) {
          console.error(`Column '${columnId}' not found`);
          process.exit(1);
        }
        const card = readCard(boardRoot, cardId);
        if (!card) {
          console.error(`Card '${cardId}' not found`);
          process.exit(1);
        }
        const fromColumnId = card.metadata.column ?? manifest.columns[0]?.id ?? 'backlog';

        // Run policies unless forced
        if (!opts.force) {
          for (const policyId of [...(manifest.board_policies ?? []), ...(toCol.policies ?? [])]) {
            const policy = manifest.policies?.[policyId];
            if (!policy?.script) continue;
            const payload = { card_id: cardId, from_column: fromColumnId, to_column: columnId };
            const violated = await runPolicyScript(boardRoot, policy.script, payload, consoleLogger);
            if (violated) {
              console.error(`Policy '${policyId}' blocked: ${policy.message}`);
              console.error('Use --force to bypass');
              process.exit(1);
            }
          }
        }

        const now = new Date().toISOString();
        const newMetadata = {
          ...card.metadata,
          column: columnId,
          ...(manifest.column_stamps?.active_at === columnId && !card.metadata.active_at ? { active_at: now } : {}),
          ...(manifest.column_stamps?.done_at === columnId ? { done_at: now } : {})
        };

        const updatedCard = { ...card, metadata: newMetadata };
        writeCard(boardRoot, updatedCard);
        fireHook(boardRoot, manifest, 'card.moved', { card_id: cardId, from_column: fromColumnId, to_column: columnId }, consoleLogger);

        if (opts.json) {
          console.log(JSON.stringify(updatedCard, null, 2));
        } else {
          console.log(`Moved ${cardId} from ${fromColumnId} to ${columnId}`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Error: ' + msg);
        process.exit(1);
      }
    });
}

import { Command } from 'commander';
import { getBoardRoot, readManifest, writeCard, generateId, calcOrder, fireHook } from '@personal-kanban/core';
import type { Card } from '@personal-kanban/core';
import { consoleLogger } from '../logger';

export function registerAdd(program: Command): void {
  program
    .command('add <title>')
    .description('Add a new card')
    .option('-c, --column <id>', 'Target column', 'backlog')
    .option('-t, --tag <tag>', 'Tag to apply (e.g. #infra)')
    .option('--json', 'Output as JSON')
    .action((title: string, opts) => {
      try {
        const boardRoot = getBoardRoot(process.cwd());
        const manifest = readManifest(boardRoot);
        const col = manifest.columns.find(c => c.id === opts.column);
        if (!col) {
          console.error(`Column '${opts.column}' not found`);
          process.exit(1);
        }
        // First card in a column gets order = calcOrder(0, 1) = 0.5
        const order = calcOrder(0, 1);
        const id = generateId();
        const now = new Date().toISOString();
        const tags = opts.tag ? [opts.tag.startsWith('#') ? opts.tag : '#' + opts.tag] : [];
        const card: Card = {
          id,
          content: `# ${title}\n`,
          metadata: {
            created_at: now,
            column: opts.column,
            order: String(order),
          }
        };
        writeCard(boardRoot, card);
        fireHook(boardRoot, manifest, 'card.created', { card_id: id, column: opts.column }, consoleLogger);
        if (opts.json) {
          console.log(JSON.stringify({ id, title, column: opts.column, tags, order, created_at: now }, null, 2));
        } else {
          console.log(`Created card ${id}: ${title}`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Error: ' + msg);
        process.exit(1);
      }
    });
}

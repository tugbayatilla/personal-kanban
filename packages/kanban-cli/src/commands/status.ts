import { Command } from 'commander';
import { getBoardRoot, loadBoardState } from '@personal-kanban/core';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show board status')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      try {
        const boardRoot = getBoardRoot(process.cwd());
        const state = loadBoardState(boardRoot);
        if (opts.json) {
          console.log(JSON.stringify(state, null, 2));
          return;
        }
        for (const col of state.manifest.columns) {
          const cards = col.cards ?? [];
          const count = cards.length;
          const wip = col.wip_limit;
          let line = `${col.label.padEnd(14)} [${count} card${count !== 1 ? 's' : ''}]`;
          if (wip !== null && count >= wip) {
            line += '  ⚠ at WIP limit';
          } else if (wip !== null && count >= wip - 1) {
            line += '  ⚠ near limit';
          }
          console.log(line);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Error: ' + msg);
        process.exit(1);
      }
    });
}

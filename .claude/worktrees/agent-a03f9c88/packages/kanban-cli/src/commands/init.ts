import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { getBoardRoot } from '@personal-kanban/core';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialize a .personal-kanban board in the current directory')
    .action(() => {
      const boardRoot = getBoardRoot(process.cwd());
      if (fs.existsSync(boardRoot)) {
        console.error('Board already exists at ' + boardRoot);
        process.exit(1);
      }
      fs.mkdirSync(path.join(boardRoot, 'cards'), { recursive: true });
      fs.mkdirSync(path.join(boardRoot, 'archive'), { recursive: true });
      fs.mkdirSync(path.join(boardRoot, 'scripts'), { recursive: true });

      const manifest = {
        version: 1,
        name: 'My Board',
        columns: [
          { id: 'backlog', label: 'Backlog', index: 0, wip_limit: null, policies: [] },
          { id: 'refined', label: 'Refined', index: 1, wip_limit: null, policies: [] },
          { id: 'planning', label: 'Planning', index: 2, wip_limit: null, policies: [] },
          { id: 'in-progress', label: 'In Progress', index: 3, wip_limit: 2, policies: ['main-branch'] },
          { id: 'review', label: 'Review', index: 4, wip_limit: null, policies: ['entry:review'] },
          { id: 'done', label: 'Done', index: 5, wip_limit: null, policies: ['entry:done'] }
        ],
        board_policies: ['wip-limit', 'no-pullback'],
        column_stamps: { active_at: 'in-progress', done_at: 'done' },
        policy_bypass_tags: ['no-policy', 'expedite'],
        policies: {},
        scripts: {},
        hooks: {},
        tags: {},
        tagColorTarget: 'tag'
      };

      fs.writeFileSync(
        path.join(boardRoot, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
      console.log('Board initialized at ' + boardRoot);
    });
}

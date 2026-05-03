import { Command } from 'commander';
import { getBoardRoot } from '@personal-kanban/core';
import { exec } from 'child_process';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Start the web UI at localhost:3737')
    .option('-p, --port <port>', 'Port to listen on', '3737')
    .action(async (opts) => {
      const port = parseInt(opts.port, 10);
      const boardRoot = getBoardRoot(process.cwd());

      // Dynamic import so the web server is not bundled unless serve is used
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createApp } = require('@personal-kanban/web');
      const app = createApp(boardRoot);

      app.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`Board running at ${url}`);
        const cmd =
          process.platform === 'darwin'
            ? `open ${url}`
            : process.platform === 'win32'
            ? `start ${url}`
            : `xdg-open ${url}`;
        exec(cmd);
      });
    });
}

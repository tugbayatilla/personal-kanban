import express from 'express';
import path from 'path';
import { createBoardRouter } from './routes/board';
import { createCardsRouter } from './routes/cards';
import { createArchiveRouter } from './routes/archive';

export function createApp(boardRoot: string) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', createBoardRouter(boardRoot));
  app.use('/api', createCardsRouter(boardRoot));
  app.use('/api', createArchiveRouter(boardRoot));
  return app;
}

if (require.main === module) {
  const port = parseInt(process.env.KANBAN_PORT ?? '3737', 10);
  const boardRoot = process.argv[2] ?? process.cwd();
  const app = createApp(boardRoot);
  app.listen(port, () => {
    console.log(`Board running at http://localhost:${port}`);
  });
}

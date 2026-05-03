import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { createApp } from '../server';

function createTempBoard(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-web-test-'));
  const boardRoot = path.join(tmpDir, '.personal-kanban');
  fs.mkdirSync(path.join(boardRoot, 'cards'), { recursive: true });
  fs.mkdirSync(path.join(boardRoot, 'archive'), { recursive: true });

  const manifest = {
    version: 1,
    name: 'Test Board',
    columns: [
      { id: 'backlog', label: 'Backlog', index: 0, wip_limit: null, policies: [] },
      { id: 'in-progress', label: 'In Progress', index: 1, wip_limit: null, policies: [] },
      { id: 'done', label: 'Done', index: 2, wip_limit: null, policies: [] },
    ],
    policies: {},
    board_policies: [],
    policy_bypass_tags: [],
    column_stamps: { done_at: 'done' },
    tags: {},
    scripts: {},
    hooks: {},
    tagColorTarget: 'tag',
  };

  fs.writeFileSync(
    path.join(boardRoot, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  return boardRoot;
}

describe('POST /api/archive', () => {
  let boardRoot: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    boardRoot = createTempBoard();
    app = createApp(boardRoot);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(boardRoot), { recursive: true, force: true });
  });

  it('returns 200 with empty archived list when done column is empty', async () => {
    const res = await request(app).post('/api/archive');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ archived: [] });
  });

  it('archives Done column cards', async () => {
    // Create a card in backlog
    const createRes = await request(app)
      .post('/api/cards')
      .send({ columnId: 'backlog', title: 'Done Task' });
    const cardId = createRes.body.id;

    // Move it to done
    await request(app)
      .patch(`/api/cards/${cardId}/move`)
      .send({ toColumn: 'done', fromColumn: 'backlog' });

    // Archive done cards
    const archiveRes = await request(app).post('/api/archive');
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.archived).toContain(cardId);

    // Card should no longer appear in board
    const boardRes = await request(app).get('/api/board');
    expect(boardRes.body.cards).not.toHaveProperty(cardId);
  });
});

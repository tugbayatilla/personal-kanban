import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { createApp } from '../server';

function createTempBoard(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-web-test-'));
  const boardRoot = path.join(tmpDir, '.personal-kanban');
  fs.mkdirSync(path.join(boardRoot, 'cards'), { recursive: true });

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

describe('POST /api/cards', () => {
  let boardRoot: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    boardRoot = createTempBoard();
    app = createApp(boardRoot);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(boardRoot), { recursive: true, force: true });
  });

  it('creates a card and returns 201', async () => {
    const res = await request(app)
      .post('/api/cards')
      .send({ columnId: 'backlog', title: 'My Task' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.metadata.column).toBe('backlog');
  });

  it('created card appears in GET /api/board', async () => {
    const createRes = await request(app)
      .post('/api/cards')
      .send({ columnId: 'backlog', title: 'My Task' });

    expect(createRes.status).toBe(201);
    const cardId = createRes.body.id;

    const boardRes = await request(app).get('/api/board');
    expect(boardRes.status).toBe(200);
    expect(boardRes.body.cards).toHaveProperty(cardId);
    expect(boardRes.body.cards[cardId].metadata.column).toBe('backlog');
  });

  it('returns 400 when columnId is missing', async () => {
    const res = await request(app)
      .post('/api/cards')
      .send({ title: 'My Task' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when column does not exist', async () => {
    const res = await request(app)
      .post('/api/cards')
      .send({ columnId: 'nonexistent', title: 'My Task' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/cards/:id', () => {
  let boardRoot: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    boardRoot = createTempBoard();
    app = createApp(boardRoot);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(boardRoot), { recursive: true, force: true });
  });

  it('deletes a card and it no longer appears in board', async () => {
    const createRes = await request(app)
      .post('/api/cards')
      .send({ columnId: 'backlog', title: 'To Delete' });
    const cardId = createRes.body.id;

    const deleteRes = await request(app).delete(`/api/cards/${cardId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toEqual({ ok: true });

    const boardRes = await request(app).get('/api/board');
    expect(boardRes.body.cards).not.toHaveProperty(cardId);
  });

  it('returns 404 when card does not exist', async () => {
    const res = await request(app).delete('/api/cards/nonexistent-id');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/cards/:id/move', () => {
  let boardRoot: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    boardRoot = createTempBoard();
    app = createApp(boardRoot);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(boardRoot), { recursive: true, force: true });
  });

  it('moves a card to a different column', async () => {
    const createRes = await request(app)
      .post('/api/cards')
      .send({ columnId: 'backlog', title: 'Move Me' });
    const cardId = createRes.body.id;

    const moveRes = await request(app)
      .patch(`/api/cards/${cardId}/move`)
      .send({ toColumn: 'in-progress', fromColumn: 'backlog' });

    expect(moveRes.status).toBe(200);
    expect(moveRes.body.metadata.column).toBe('in-progress');
  });

  it('updated column appears in GET /api/board', async () => {
    const createRes = await request(app)
      .post('/api/cards')
      .send({ columnId: 'backlog', title: 'Move Me' });
    const cardId = createRes.body.id;

    await request(app)
      .patch(`/api/cards/${cardId}/move`)
      .send({ toColumn: 'in-progress', fromColumn: 'backlog' });

    const boardRes = await request(app).get('/api/board');
    expect(boardRes.body.cards[cardId].metadata.column).toBe('in-progress');
  });

  it('returns 404 when card does not exist', async () => {
    const res = await request(app)
      .patch('/api/cards/nonexistent-id/move')
      .send({ toColumn: 'in-progress' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when target column does not exist', async () => {
    const createRes = await request(app)
      .post('/api/cards')
      .send({ columnId: 'backlog', title: 'Test' });
    const cardId = createRes.body.id;

    const res = await request(app)
      .patch(`/api/cards/${cardId}/move`)
      .send({ toColumn: 'nonexistent' });
    expect(res.status).toBe(404);
  });
});

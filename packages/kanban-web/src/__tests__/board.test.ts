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

describe('GET /api/board', () => {
  let boardRoot: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    boardRoot = createTempBoard();
    app = createApp(boardRoot);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(boardRoot), { recursive: true, force: true });
  });

  it('returns 200 with manifest and cards', async () => {
    const res = await request(app).get('/api/board');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('manifest');
    expect(res.body).toHaveProperty('cards');
  });

  it('returns manifest with correct column structure', async () => {
    const res = await request(app).get('/api/board');
    expect(res.status).toBe(200);
    const { manifest } = res.body;
    expect(manifest.columns).toHaveLength(3);
    expect(manifest.columns[0].id).toBe('backlog');
    expect(manifest.columns[1].id).toBe('in-progress');
    expect(manifest.columns[2].id).toBe('done');
  });

  it('returns empty cards object when no cards exist', async () => {
    const res = await request(app).get('/api/board');
    expect(res.status).toBe(200);
    expect(res.body.cards).toEqual({});
  });
});

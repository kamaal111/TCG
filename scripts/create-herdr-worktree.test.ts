import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { worktreeEnv } from './create-herdr-worktree.ts';

const source = `# Local development
PORT=8080
DATABASE_URL=postgresql://user:password@localhost:5432/tcg
BETTER_AUTH_URL=http://localhost:8080
BETTER_AUTH_SECRET=keep-this-secret
OBJECT_STORAGE_ENDPOINT=http://localhost:9000
SCRYDEX_API_KEY=keep-this-key
`;

void describe('worktreeEnv', () => {
  void it('keeps credentials while giving the app and Compose services matching ports', () => {
    const result = worktreeEnv(source, { app: 8100, db: 5500, storage: 9100 }, 'feature/cards');

    assert.ok(result.includes('PORT=8100\n'));
    assert.ok(result.includes('DATABASE_URL=postgresql://user:password@localhost:5500/tcg\n'));
    assert.ok(result.includes('BETTER_AUTH_URL=http://localhost:8100/\n'));
    assert.ok(result.includes('OBJECT_STORAGE_ENDPOINT=http://localhost:9100/\n'));
    assert.ok(result.includes('TCG_DB_PORT=5500\n'));
    assert.ok(result.includes('TCG_STORAGE_PORT=9100\n'));
    assert.match(result, /COMPOSE_PROJECT_NAME=tcg-wt-[a-f0-9]{12}\n/);
    assert.ok(result.includes('BETTER_AUTH_SECRET=keep-this-secret\n'));
    assert.ok(result.includes('SCRYDEX_API_KEY=keep-this-key\n'));
    assert.ok(result.includes('# Local development\n'));
  });

  void it('updates existing Compose overrides and local public URL without duplicating them', () => {
    const withOverrides = `${source}TCG_DB_PORT=5432\nTCG_STORAGE_PORT=9000\nPUBLIC_BASE_URL=http://localhost:8080/assets\n`;
    const result = worktreeEnv(withOverrides, { app: 8101, db: 5501, storage: 9101 }, 'feature/auth');

    assert.equal(result.match(/^TCG_DB_PORT=/gm)?.length, 1);
    assert.equal(result.match(/^TCG_STORAGE_PORT=/gm)?.length, 1);
    assert.ok(result.includes('PUBLIC_BASE_URL=http://localhost:8101/assets\n'));
  });

  void it('rejects nonlocal service URLs before creating a worktree', () => {
    assert.throws(
      () =>
        worktreeEnv(
          source.replace('localhost:5432', 'db.example.com:5432'),
          { app: 8100, db: 5500, storage: 9100 },
          'feature/cards',
        ),
      /DATABASE_URL must use localhost/,
    );
  });
});

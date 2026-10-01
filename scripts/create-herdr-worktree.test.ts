import { describe, expect, it } from 'vitest';

import { worktreeEnv } from './create-herdr-worktree.ts';

const source = `# Local development
PORT=8080
DATABASE_URL=postgresql://user:password@localhost:5432/tcg
BETTER_AUTH_URL=http://localhost:8080
BETTER_AUTH_SECRET=keep-this-secret
OBJECT_STORAGE_ENDPOINT=http://localhost:9000
SCRYDEX_API_KEY=keep-this-key
`;

describe('worktreeEnv', () => {
  it('keeps credentials while giving the app and Compose services matching ports', () => {
    const result = worktreeEnv(source, { app: 8100, db: 5500, storage: 9100 }, 'feature/cards');

    expect(result).toContain('PORT=8100\n');
    expect(result).toContain('DATABASE_URL=postgresql://user:password@localhost:5500/tcg\n');
    expect(result).toContain('BETTER_AUTH_URL=http://localhost:8100/\n');
    expect(result).toContain('OBJECT_STORAGE_ENDPOINT=http://localhost:9100/\n');
    expect(result).toContain('TCG_DB_PORT=5500\n');
    expect(result).toContain('TCG_STORAGE_PORT=9100\n');
    expect(result).toMatch(/COMPOSE_PROJECT_NAME=tcg-wt-[a-f0-9]{12}\n/);
    expect(result).toContain('BETTER_AUTH_SECRET=keep-this-secret\n');
    expect(result).toContain('SCRYDEX_API_KEY=keep-this-key\n');
    expect(result).toContain('# Local development\n');
  });

  it('updates existing Compose overrides and local public URL without duplicating them', () => {
    const withOverrides = `${source}TCG_DB_PORT=5432\nTCG_STORAGE_PORT=9000\nPUBLIC_BASE_URL=http://localhost:8080/assets\n`;
    const result = worktreeEnv(withOverrides, { app: 8101, db: 5501, storage: 9101 }, 'feature/auth');

    expect(result.match(/^TCG_DB_PORT=/gm)?.length).toBe(1);
    expect(result.match(/^TCG_STORAGE_PORT=/gm)?.length).toBe(1);
    expect(result).toContain('PUBLIC_BASE_URL=http://localhost:8101/assets\n');
  });

  it('rejects nonlocal service URLs before creating a worktree', () => {
    expect(() =>
      worktreeEnv(
        source.replace('localhost:5432', 'db.example.com:5432'),
        { app: 8100, db: 5500, storage: 9100 },
        'feature/cards',
      ),
    ).toThrow(/DATABASE_URL must use localhost/);
  });
});

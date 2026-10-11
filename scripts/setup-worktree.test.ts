import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import url from 'node:url';

import type { TestContext } from 'vitest';

import { worktreeEnv } from './configure-worktree-env.ts';
import { worktreeFixture } from './worktree-test-fixture.ts';

const script = url.fileURLToPath(new URL('./setup-worktree.sh', import.meta.url));

const source = `# Local settings
PORT=8080
DATABASE_URL=postgresql://user:fixture-secret@localhost:5432/tcg
BETTER_AUTH_URL=http://localhost:8080
OBJECT_STORAGE_ENDPOINT=http://localhost:9000
BETTER_AUTH_SECRET=fixture-secret
`;

const unitSource = `# Local development
PORT=8080
DATABASE_URL=postgresql://user:password@localhost:5432/tcg
BETTER_AUTH_URL=http://localhost:8080
BETTER_AUTH_SECRET=keep-this-secret
OBJECT_STORAGE_ENDPOINT=http://localhost:9000
SCRYDEX_API_KEY=keep-this-key
`;

describe('worktreeEnv', () => {
  it('keeps credentials while giving the app and Compose services matching ports', () => {
    const result = worktreeEnv(unitSource, { app: 8100, db: 5500, storage: 9100 }, 'tcg-wt-0123456789ab');

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
    const withOverrides = `${unitSource}TCG_DB_PORT=5432\nTCG_STORAGE_PORT=9000\nPUBLIC_BASE_URL=http://localhost:8080/assets\n`;
    const result = worktreeEnv(withOverrides, { app: 8101, db: 5501, storage: 9101 }, 'tcg-wt-0123456789ab');

    expect(result.match(/^TCG_DB_PORT=/gm)?.length).toBe(1);
    expect(result.match(/^TCG_STORAGE_PORT=/gm)?.length).toBe(1);
    expect(result).toContain('PUBLIC_BASE_URL=http://localhost:8101/assets\n');
  });

  it('rejects nonlocal service URLs before rewriting the environment', () => {
    expect(() =>
      worktreeEnv(
        unitSource.replace('localhost:5432', 'db.example.com:5432'),
        { app: 8100, db: 5500, storage: 9100 },
        'tcg-wt-0123456789ab',
      ),
    ).toThrow(/DATABASE_URL must use localhost/);
  });
});

async function fixture() {
  const { root, main, checkout, git } = await worktreeFixture();
  git(['worktree', 'add', '--detach', checkout]);
  await fs.writeFile(path.join(main, '.env'), source, { mode: 0o600 });

  const run = (cwd = checkout, env = process.env) =>
    childProcess.spawnSync('bash', [script], { cwd, env, encoding: 'utf8' });

  const read = () => fs.readFile(path.join(checkout, '.env'), 'utf8');

  return { root, main, checkout, git, run, read, lock: path.join(main, '.git', 'tcg-worktree-setup.lock') };
}

async function listen(t: TestContext, port: number) {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
  t.onTestFinished(
    () => new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))),
  );
}

function ports(contents: string): number[] {
  return ['PORT', 'TCG_DB_PORT', 'TCG_STORAGE_PORT'].map(key => {
    const match = new RegExp(`^${key}=(\\d+)$`, 'm').exec(contents);
    expect(match).not.toBeNull();

    return Number(match?.[1]);
  });
}

test('copies main environment into a detached checkout with aligned ports and private permissions', async () => {
  const f = await fixture();
  const result = f.run();
  const contents = await f.read();
  const [app, db, storage] = ports(contents);

  expect(result.status).toBe(0);
  expect(contents).toContain(`BETTER_AUTH_URL=http://localhost:${app}/`);
  expect(contents).toContain(`DATABASE_URL=postgresql://user:fixture-secret@localhost:${db}/tcg`);
  expect(contents).toContain(`OBJECT_STORAGE_ENDPOINT=http://localhost:${storage}/`);
  expect(contents).toContain('BETTER_AUTH_SECRET=fixture-secret');
  expect(contents).toContain('# Local settings');
  expect(contents).toMatch(/COMPOSE_PROJECT_NAME=tcg-wt-[a-f0-9]{12}/);
  expect((await fs.stat(path.join(f.checkout, '.env'))).mode & 0o777).toBe(0o600);
  expect(await fs.readFile(path.join(f.main, '.env'), 'utf8')).toBe(source);
  expect(result.stdout + result.stderr).not.toContain('fixture-secret');
  await expect(fs.access(f.lock)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('preserves existing checkout credentials instead of replacing them with main credentials', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.checkout, '.env'), source.replaceAll('fixture-secret', 'checkout-secret'));

  expect(f.run().status).toBe(0);
  expect(await f.read()).toContain('BETTER_AUTH_SECRET=checkout-secret');
  expect(await f.read()).not.toContain('fixture-secret');
});

test('keeps configured ports and legacy Compose identity while services run and branches change', async t => {
  const f = await fixture();
  expect(f.run().status).toBe(0);
  const configured = (await f.read()).replace(/COMPOSE_PROJECT_NAME=.*/, 'COMPOSE_PROJECT_NAME=tcg-wt-legacy');
  await fs.writeFile(path.join(f.checkout, '.env'), configured);
  await listen(t, ports(configured)[0] ?? 0);
  f.git(['switch', '-c', 'renamed-branch'], f.checkout);

  expect(f.run().status).toBe(0);
  expect(await f.read()).toBe(configured);
});

test('reallocates copied configuration reserved by another registered worktree', async () => {
  const f = await fixture();
  expect(f.run().status).toBe(0);
  const original = await f.read();
  const second = path.join(f.root, 'second');
  f.git(['worktree', 'add', '--detach', second]);
  await fs.writeFile(path.join(second, '.env'), original);

  expect(f.run(second).status).toBe(0);
  const configured = await fs.readFile(path.join(second, '.env'), 'utf8');
  expect(ports(configured).every(port => !ports(original).includes(port))).toBe(true);
  expect(configured.match(/^COMPOSE_PROJECT_NAME=.*$/m)).not.toEqual(original.match(/^COMPOSE_PROJECT_NAME=.*$/m));
  expect(await f.read()).toBe(original);
});

test('skips the first port set when its API port is occupied', async t => {
  const f = await fixture();
  await listen(t, 8100);

  expect(f.run().status).toBe(0);
  expect(ports(await f.read())).not.toContain(8100);
});

test('fails without creating environment when neither checkout has a source', async () => {
  const f = await fixture();
  await fs.unlink(path.join(f.main, '.env'));
  const result = f.run();

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('No .env');
  await expect(f.read()).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.access(f.lock)).rejects.toMatchObject({ code: 'ENOENT' });
});

test.each([
  ['remote database', source.replace('localhost:5432', 'db.example.com:5432'), 'DATABASE_URL must use localhost'],
  ['duplicate port', `${source}PORT=8080\n`, 'Duplicate PORT'],
])('rejects %s without modifying environment', async (_name, contents, message) => {
  const f = await fixture();
  await fs.writeFile(path.join(f.checkout, '.env'), contents);
  const result = f.run();

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
  expect(await f.read()).toBe(contents);
  await expect(fs.access(f.lock)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('rejects main checkout setup without modifying its environment', async () => {
  const f = await fixture();

  expect(f.run(f.main).status).toBe(1);
  expect(await fs.readFile(path.join(f.main, '.env'), 'utf8')).toBe(source);
});

test('reports lock contention without removing another setup lock', async () => {
  const f = await fixture();
  await fs.mkdir(f.lock);
  const result = f.run();

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Worktree setup is locked');
  expect((await fs.stat(f.lock)).isDirectory()).toBe(true);
  await expect(f.read()).rejects.toMatchObject({ code: 'ENOENT' });
});

test('reports exhaustion when other worktrees reserve every allocation candidate', async () => {
  const f = await fixture();
  const bin = path.join(f.root, 'bin');
  const listing = path.join(f.root, 'listing');
  await fs.mkdir(bin);

  const checkouts = await Promise.all(
    Array.from({ length: 900 }, async (_, offset) => {
      const checkout = path.join(f.root, `reserved-${offset}`);
      await fs.mkdir(checkout);
      await fs.writeFile(path.join(checkout, '.env'), `PORT=${8100 + offset}\n`);

      return checkout;
    }),
  );

  await fs.writeFile(listing, [f.main, f.checkout, ...checkouts].map(checkout => `worktree ${checkout}\0\0`).join(''));
  const realGit = childProcess.spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  await fs.writeFile(
    path.join(bin, 'git'),
    `#!/bin/bash
if [[ "$1" == worktree && "$2" == list ]]; then
  cat "$LISTING"
else
  exec "$REAL_GIT" "$@"
fi
`,
    { mode: 0o755 },
  );
  await fs.writeFile(path.join(f.checkout, '.env'), source);

  const result = f.run(f.checkout, {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    REAL_GIT: realGit,
    LISTING: listing,
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('No free port set');
  expect(await f.read()).toBe(source);
});

test('accepts local service URLs with default ports when reserving peer checkout ports', async () => {
  const f = await fixture();
  await fs.writeFile(
    path.join(f.main, '.env'),
    source.replace(':5432', '').replace(':9000', '').replaceAll(':8080', ''),
  );
  const result = f.run();

  expect(result.status).toBe(0);
  const contents = await f.read();
  const [, db] = ports(contents);

  expect(contents).toContain(`DATABASE_URL=postgresql://user:fixture-secret@localhost:${db}/tcg`);
});

test('rejects a checkout environment symlink and removes its own temporary files and lock', async () => {
  const f = await fixture();
  await fs.symlink(path.join(f.main, '.env'), path.join(f.checkout, '.env'));
  const result = f.run();

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('.env must be a regular file');
  expect(await fs.readFile(path.join(f.main, '.env'), 'utf8')).toBe(source);
  expect((await fs.readdir(f.checkout)).filter(name => name.startsWith('.env.setup-'))).toEqual([]);
  await expect(fs.access(f.lock)).rejects.toMatchObject({ code: 'ENOENT' });
});

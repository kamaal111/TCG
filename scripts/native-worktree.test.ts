import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

import { worktreeFixture } from './worktree-test-fixture.ts';

async function nativeFixture() {
  const f = await worktreeFixture();

  for (const filename of ['justfile', '.gitignore']) {
    await fs.copyFile(url.fileURLToPath(new URL(`../${filename}`, import.meta.url)), path.join(f.main, filename));
  }

  await fs.mkdir(path.join(f.main, 'scripts'));

  for (const filename of [
    'native-worktree-common.sh',
    'create-worktree.sh',
    'cleanup-worktree.sh',
    'setup-worktree.sh',
    'configure-worktree-env.ts',
  ]) {
    await fs.copyFile(
      url.fileURLToPath(new URL(`./${filename}`, import.meta.url)),
      path.join(f.main, 'scripts', filename),
    );
  }

  f.git(['add', '.']);
  f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'Native recipes']);
  f.git(['remote', 'add', 'origin', f.main]);
  await fs.writeFile(
    path.join(f.main, '.env'),
    'DATABASE_URL=postgresql://user:fixture-secret@localhost:5432/tcg\nBETTER_AUTH_URL=http://localhost:8080\nOBJECT_STORAGE_ENDPOINT=http://localhost:9000\n',
    { mode: 0o600 },
  );

  const run = (args: string[], cwd = f.main) =>
    childProcess.spawnSync('just', args, { cwd, encoding: 'utf8', env: process.env });

  const target = path.join(f.main, '.agents', 'worktrees', 'feature', 'cards');

  return { ...f, run, target };
}

test('creates from fetched origin/main and configures an ignored private environment', async () => {
  const f = await nativeFixture();
  const result = f.run(['create-worktree', 'feature/cards']);

  expect(result.status).toBe(0);
  expect(f.git(['rev-parse', 'feature/cards'])).toBe(f.git(['rev-parse', 'origin/main']));
  expect(await fs.readFile(path.join(f.target, '.env'), 'utf8')).toContain('COMPOSE_PROJECT_NAME=tcg-wt-');
  expect((await fs.stat(path.join(f.target, '.env'))).mode & 0o777).toBe(0o600);
  expect(result.stdout + result.stderr).not.toContain('fixture-secret');
  expect(f.git(['status', '--porcelain'])).toBe('');
});

test.each([
  ['feature/shared', 'refs/heads/feature/shared'],
  ['origin/release', 'refs/remotes/origin/release'],
])('uses explicit ref %s without contacting origin', async (base, ref) => {
  const f = await nativeFixture();
  f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '--allow-empty', '-m', 'Base']);
  f.git(['update-ref', ref, 'HEAD']);
  const expected = f.git(['rev-parse', 'HEAD']);
  f.git(['remote', 'set-url', 'origin', path.join(f.root, 'missing-remote')]);
  const result = f.run(['create-worktree', 'feature/cards', base]);

  expect(result.status).toBe(0);
  expect(f.git(['rev-parse', 'feature/cards'])).toBe(expected);
});

test('creates and cleans up from a linked checkout using the main checkout anchor', async () => {
  const f = await nativeFixture();
  f.git(['worktree', 'add', '--detach', f.checkout]);
  const created = f.run(['create-worktree', 'feature/cards'], f.checkout);
  const removed = f.run(['cleanup-worktree', 'feature/cards'], f.checkout);

  expect(created.status).toBe(0);
  expect(created.stdout).toContain(f.target);
  expect(removed.status).toBe(0);
  expect(f.git(['show-ref', '--verify', 'refs/heads/feature/cards'])).toContain('refs/heads/feature/cards');
  await expect(fs.access(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(f.git(['worktree', 'list', '--porcelain'])).not.toContain(f.target);
});

test.each(['../escape', '/absolute', '-option', 'invalid branch', 'feature/../escape'])(
  'rejects unsafe or invalid branch %s without creating a checkout',
  async branch => {
    const f = await nativeFixture();
    const result = f.run(['create-worktree', branch]);

    expect(result.status).not.toBe(0);
    expect(f.git(['worktree', 'list', '--porcelain'])).not.toContain('.agents/worktrees');
  },
);

test('rejects an existing branch', async () => {
  const f = await nativeFixture();
  f.git(['branch', 'feature/cards']);
  const result = f.run(['create-worktree', 'feature/cards']);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('already exists');
  await expect(fs.access(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('preserves an occupied destination', async () => {
  const f = await nativeFixture();
  await fs.mkdir(f.target, { recursive: true });
  await fs.writeFile(path.join(f.target, 'keep'), 'existing');
  const result = f.run(['create-worktree', 'feature/cards']);

  expect(result.status).not.toBe(0);
  expect(await fs.readFile(path.join(f.target, 'keep'), 'utf8')).toBe('existing');
});

test('rejects a symlink in the destination hierarchy', async () => {
  const f = await nativeFixture();
  await fs.mkdir(path.join(f.main, '.agents'));
  await fs.symlink(f.root, path.join(f.main, '.agents', 'worktrees'));
  const result = f.run(['create-worktree', 'feature/cards']);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('symlinks');
  await expect(fs.access(path.join(f.root, 'feature'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('rejects a missing explicit base without creating a branch', async () => {
  const f = await nativeFixture();
  const result = f.run(['create-worktree', 'feature/cards', 'missing']);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Cannot resolve base');
  expect(f.git(['branch', '--list', 'feature/cards'])).toBe('');
});

test('stops when fetching the default base fails', async () => {
  const f = await nativeFixture();
  f.git(['remote', 'remove', 'origin']);
  const result = f.run(['create-worktree', 'feature/cards']);

  expect(result.status).not.toBe(0);
  expect(f.git(['branch', '--list', 'feature/cards'])).toBe('');
});

test('preserves a created checkout and reports recovery when setup fails', async () => {
  const f = await nativeFixture();
  await fs.unlink(path.join(f.main, '.env'));
  const result = f.run(['create-worktree', 'feature/cards']);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('checkout preserved');
  expect(result.stderr).toContain('just setup-worktree');
  expect(f.git(['branch', '--show-current'], f.target)).toBe('feature/cards');
});

test.each([
  ['tracked', 'justfile'],
  ['untracked', 'new-file'],
])('refuses cleanup with %s changes', async (_kind, relative) => {
  const f = await nativeFixture();
  expect(f.run(['create-worktree', 'feature/cards']).status).toBe(0);
  const filename = path.join(f.target, relative);
  await fs.writeFile(filename, 'keep my changes');
  const result = f.run(['cleanup-worktree', 'feature/cards']);

  expect(result.status).not.toBe(0);
  expect(await fs.readFile(filename, 'utf8')).toBe('keep my changes');
});

test('refuses cleanup of a locked worktree', async () => {
  const f = await nativeFixture();
  expect(f.run(['create-worktree', 'feature/cards']).status).toBe(0);
  f.git(['worktree', 'lock', f.target]);
  const result = f.run(['cleanup-worktree', 'feature/cards']);

  expect(result.status).not.toBe(0);
  expect((await fs.stat(f.target)).isDirectory()).toBe(true);
});

test('refuses removal of the currently executing checkout', async () => {
  const f = await nativeFixture();
  expect(f.run(['create-worktree', 'feature/cards']).status).toBe(0);
  const result = f.run(['cleanup-worktree', 'feature/cards'], f.target);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('currently executing');
  expect((await fs.stat(f.target)).isDirectory()).toBe(true);
});

test('refuses cleanup of an unregistered directory', async () => {
  const f = await nativeFixture();
  await fs.mkdir(f.target, { recursive: true });
  const result = f.run(['cleanup-worktree', 'feature/cards']);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('No matching registered worktree');
  expect((await fs.stat(f.target)).isDirectory()).toBe(true);
});

test('refuses cleanup of a branch registered outside the managed directory', async () => {
  const f = await nativeFixture();
  f.git(['worktree', 'add', '-b', 'feature/cards', f.checkout]);
  const result = f.run(['cleanup-worktree', 'feature/cards']);

  expect(result.status).not.toBe(0);
  expect((await fs.stat(f.checkout)).isDirectory()).toBe(true);
});

test('reports a missing checkout', async () => {
  const f = await nativeFixture();
  const result = f.run(['cleanup-worktree', 'feature/cards']);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('does not exist');
});

test('creates and cleans up when the main checkout path contains spaces', async () => {
  const f = await nativeFixture();
  const moved = path.join(f.root, 'main with spaces');
  await fs.rename(f.main, moved);
  f.git(['remote', 'set-url', 'origin', moved], moved);
  const created = f.run(['create-worktree', 'feature/cards'], moved);
  const removed = f.run(['cleanup-worktree', 'feature/cards'], moved);

  expect(created.status).toBe(0);
  expect(created.stdout).toContain(path.join(moved, '.agents/worktrees/feature/cards'));
  expect(removed.status).toBe(0);
  expect(f.git(['branch', '--list', 'feature/cards'], moved)).toContain('feature/cards');
});

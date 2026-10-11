import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

import { worktreeFixture } from './worktree-test-fixture.ts';

async function wrapperFixture() {
  const { root, main, checkout, realGit, git } = await worktreeFixture();
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'calls');
  await fs.mkdir(bin);
  await fs.writeFile(log, '');
  git(['remote', 'add', 'origin', main]);
  await fs.copyFile(url.fileURLToPath(new URL('../justfile', import.meta.url)), path.join(main, 'justfile'));
  await fs.mkdir(path.join(main, 'scripts'));

  for (const script of [
    'prepare-worktree.sh',
    'create-herdr-worktree.sh',
    'setup-worktree.sh',
    'configure-worktree-env.ts',
  ]) {
    await fs.copyFile(url.fileURLToPath(new URL(`./${script}`, import.meta.url)), path.join(main, 'scripts', script));
  }

  git(['add', 'justfile', 'scripts']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'Worktree recipes']);
  await fs.writeFile(
    path.join(main, '.env'),
    'DATABASE_URL=postgresql://user:fixture-secret@localhost:5432/tcg\nBETTER_AUTH_URL=http://localhost:8080\nOBJECT_STORAGE_ENDPOINT=http://localhost:9000\n',
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(bin, 'herdr'),
    `#!/bin/bash
printf 'herdr:%s\\n' "$*" >> "$CALL_LOG"
if [[ "$HERDR_EXIT" != 0 ]]; then exit "$HERDR_EXIT"; fi
"$REAL_GIT" worktree add -b "$BRANCH" "$CHECKOUT" origin/main
`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(bin, 'just'),
    `#!/bin/bash
printf 'just:%s:%s\\n' "$PWD" "$*" >> "$CALL_LOG"
if [[ "$1" == setup-worktree && "$SETUP_EXIT" != 0 ]]; then
  exit "$SETUP_EXIT"
fi
exec "$REAL_JUST" "$@"
`,
    { mode: 0o755 },
  );

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    REAL_GIT: realGit,
    REAL_JUST: childProcess.spawnSync('which', ['just'], { encoding: 'utf8' }).stdout.trim(),
    BRANCH: 'feature/cards',
    CHECKOUT: checkout,
    CALL_LOG: log,
    HERDR_EXIT: '0',
    SETUP_EXIT: '0',
  };

  const run = (overrides: NodeJS.ProcessEnv = {}, branch = env.BRANCH) =>
    childProcess.spawnSync(env.REAL_JUST, ['herdr-worktree', branch], {
      cwd: main,
      env: { ...env, ...overrides },
      encoding: 'utf8',
    });

  return { main: await fs.realpath(main), checkout, log, run, git };
}

test('creates through the Herdr boundary then runs the real shared setup recipe in the checkout', async () => {
  const f = await wrapperFixture();
  const result = f.run();
  const checkout = await fs.realpath(f.checkout);

  expect(result.status).toBe(0);
  expect(await fs.readFile(path.join(checkout, '.env'), 'utf8')).toContain('COMPOSE_PROJECT_NAME=tcg-wt-');
  expect((await fs.stat(path.join(checkout, '.env'))).mode & 0o777).toBe(0o600);
  expect(result.stdout + result.stderr).not.toContain('fixture-secret');
  expect(await fs.readFile(f.log, 'utf8')).toBe(
    `herdr:worktree create --cwd ${f.main} --branch feature/cards --base origin/main --no-focus\njust:${checkout}:setup-worktree\n`,
  );
});

test('propagates native Herdr failure without invoking setup', async () => {
  const f = await wrapperFixture();
  const result = f.run({ HERDR_EXIT: '7' });

  expect(result.status).toBe(7);
  expect(await fs.readFile(f.log, 'utf8')).not.toContain('setup-worktree');
  await expect(fs.access(f.checkout)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('propagates setup failure while preserving the created checkout', async () => {
  const f = await wrapperFixture();
  const result = f.run({ SETUP_EXIT: '9' });

  expect(result.status).toBe(9);
  expect((await fs.stat(f.checkout)).isDirectory()).toBe(true);
  expect(await fs.readFile(f.log, 'utf8')).toContain('setup-worktree');
});

test('rejects existing branches before invoking Herdr', async () => {
  const f = await wrapperFixture();
  f.git(['branch', 'feature/cards']);
  const result = f.run();

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('already exists');
  expect(await fs.readFile(f.log, 'utf8')).not.toContain('herdr:');
});

test('rejects invalid branch names through preparation before invoking Herdr', async () => {
  const f = await wrapperFixture();
  const result = f.run({}, 'invalid branch');

  expect(result.status).not.toBe(0);
  expect(await fs.readFile(f.log, 'utf8')).toBe('');
  expect(await fs.readFile(f.log, 'utf8')).not.toContain('herdr:');
});

test('stops before Herdr when fetching the worktree base fails', async () => {
  const f = await wrapperFixture();
  f.git(['remote', 'remove', 'origin']);
  const result = f.run();

  expect(result.status).not.toBe(0);
  expect(await fs.readFile(f.log, 'utf8')).not.toContain('herdr:');
  await expect(fs.access(f.checkout)).rejects.toMatchObject({ code: 'ENOENT' });
});

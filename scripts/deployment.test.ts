import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import type { TestContext } from 'vitest';

const release = url.fileURLToPath(new URL('../deploy/release.sh', import.meta.url));

const guard = url.fileURLToPath(new URL('./check-infrastructure-plan.ts', import.meta.url));

const runtime = `ghcr.io/example/tcg-server@sha256:${'a'.repeat(64)}`;

const migration = `ghcr.io/example/tcg-server-migrations@sha256:${'b'.repeat(64)}`;

const oldRelease = `TCG_RUNTIME_IMAGE=ghcr.io/example/tcg-server@sha256:${'c'.repeat(64)}\nTCG_MIGRATION_IMAGE=${migration}\n`;

async function fixture(t: Pick<TestContext, 'onTestFinished'>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-deployment-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin);
  await fs.writeFile(path.join(root, 'host.env'), 'API_HOSTNAME=\n');
  await fs.writeFile(path.join(root, 'server.env'), 'BETTER_AUTH_URL=http://127.0.0.1:8080\n');
  await fs.writeFile(path.join(root, 'registry-repository'), 'ghcr.io/example/tcg-server\n');
  await fs.writeFile(path.join(root, 'release.env'), oldRelease);
  const log = path.join(root, 'commands.log');
  await fs.writeFile(log, '');
  await fs.writeFile(
    path.join(bin, 'docker'),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const command = args.join(' ');
fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'image') console.log((process.env.MISMATCH && command.includes('-migrations@') ? 'e' : 'd').repeat(40));
if (process.env.FAIL_PHASE && command.includes(process.env.FAIL_PHASE)) {
  const marker = process.env.COMMAND_LOG + '.failed';
  if (process.env.FAIL_ONCE !== '1' || !fs.existsSync(marker)) {
    fs.writeFileSync(marker, 'failed');
    process.exit(1);
  }
}
`,
    { mode: 0o755 },
  );
  await fs.writeFile(path.join(bin, 'curl'), '#!/bin/sh\nprintf \'{"message":"PONG"}\'\n', { mode: 0o755 });

  return {
    root,
    log: () => fs.readFile(log, 'utf8'),
    release: () => fs.readFile(path.join(root, 'release.env'), 'utf8'),
    run: (args: string[], extra: NodeJS.ProcessEnv = {}) =>
      childProcess.spawnSync('bash', [release, ...args], {
        env: {
          ...process.env,
          TCG_DEPLOY_DIRECTORY: root,
          PATH: `${bin}:${process.env.PATH}`,
          COMMAND_LOG: log,
          ...extra,
        },
        encoding: 'utf8',
      }),
  };
}

test('rejects public deployment without a domain before pulling images or migrating', async t => {
  const f = await fixture(t);
  const result = f.run(['release', runtime, migration, 'public', 'false']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('requires a configured API hostname');
  expect(await f.log()).toBe('');
  expect(await f.release()).toBe(oldRelease);
});

test('refuses a mutable tag or an image outside the configured registry repository', async t => {
  const f = await fixture(t);
  const result = f.run(['release', 'ghcr.io/attacker/server:latest', migration, 'private', 'false']);
  expect(result.status).toBe(1);
  expect(await f.log()).toBe('');
});

test('failed dependency checks preserve the current release and never migrate', async t => {
  const f = await fixture(t);

  const result = f.run(['release', runtime, migration, 'private', 'false'], {
    FAIL_PHASE: 'scripts/check-deployment.ts',
  });

  expect(result.status).toBe(1);
  expect(await f.release()).toBe(oldRelease);
  expect(await f.log()).not.toContain('scripts/migrate.ts');
});

test('a migration failure does not stop or replace the running server', async t => {
  const f = await fixture(t);
  const result = f.run(['release', runtime, migration, 'private', 'false'], { FAIL_PHASE: 'scripts/migrate.ts' });
  expect(result.status).toBe(1);
  expect(await f.release()).toBe(oldRelease);
  expect(await f.log()).not.toContain('"up"');
});

test('a private deployment records immutable images and can be repeated', async t => {
  const f = await fixture(t);
  expect(f.run(['release', runtime, migration, 'private', 'false']).status).toBe(0);
  expect(f.run(['release', runtime, migration, 'private', 'false']).status).toBe(0);
  expect(await f.release()).toBe(`TCG_RUNTIME_IMAGE=${runtime}\nTCG_MIGRATION_IMAGE=${migration}\n`);
  expect(await fs.readdir(f.root)).not.toContain('.deployment-lock');
});

test('does not roll back after migration unless compatibility was explicitly confirmed', async t => {
  const f = await fixture(t);
  const result = f.run(['release', runtime, migration, 'private', 'false'], { FAIL_PHASE: 'up --detach' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('rollback was not authorized');
  expect(await f.release()).toContain(runtime);
});

test('refuses to run alongside host configuration or another release', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, '.deployment-lock'));
  expect(f.run(['release', runtime, migration, 'private', 'false']).status).toBe(1);
  expect(await f.log()).toBe('');
});

test.each(['digitalocean_droplet', 'digitalocean_database_cluster', 'digitalocean_spaces_bucket'])(
  'blocks replacement of protected %s resources',
  async type => {
    const f = await fixture({ onTestFinished });
    const file = path.join(f.root, 'plan.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        resource_changes: [{ address: 'module.tcg.existing', type, change: { actions: ['delete', 'create'] } }],
      }),
    );
    const result = childProcess.spawnSync(process.execPath, [guard, file], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Infrastructure plan rejected');
  },
);

test('accepts non-destructive adoption plans', async t => {
  const f = await fixture(t);
  const file = path.join(f.root, 'plan.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      resource_changes: [
        { address: 'module.tcg.existing', type: 'digitalocean_droplet', change: { actions: ['no-op'] } },
      ],
    }),
  );
  expect(childProcess.spawnSync(process.execPath, [guard, file]).status).toBe(0);
});

test('restores the previous application after a health failure only with explicit schema compatibility', async t => {
  const f = await fixture(t);

  const result = f.run(['release', runtime, migration, 'private', 'true'], {
    FAIL_PHASE: 'up --detach',
    FAIL_ONCE: '1',
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Restored previous application image');
  expect(await f.release()).toBe(oldRelease);
});

test('rejects runtime and migration images from different commits before migrations', async t => {
  const f = await fixture(t);
  const result = f.run(['release', runtime, migration, 'private', 'false'], { MISMATCH: '1' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('same commit');
  expect(await f.log()).not.toContain('scripts/migrate.ts');
});

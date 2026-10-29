import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import type { TestContext } from 'vitest';
import z from 'zod';

const source = url.fileURLToPath(new URL('./currency-schedule.sh', import.meta.url));

async function fixture(t: TestContext) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tcg currencies & schedule ')));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  await Promise.all(
    ['bin', 'scripts', 'server/scripts'].map(directory => fs.mkdir(path.join(root, directory), { recursive: true })),
  );
  const script = path.join(root, 'scripts/currency-schedule.sh');
  await fs.copyFile(source, script);
  await fs.symlink(path.resolve('server/src'), path.join(root, 'server/src'));
  const envFile = path.join(root, 'production.env');
  await fs.writeFile(
    envFile,
    'DATABASE_URL=postgresql://tcg:fixture-secret@db/tcg\nBETTER_AUTH_URL=https://tcg.test\n',
    { mode: 0o600 },
  );
  const calls = path.join(root, 'calls.jsonl');
  const installed = path.join(root, 'installed.plist');
  const loaded = path.join(root, 'loaded');
  const collected = path.join(root, 'collected.json');
  await fs.writeFile(calls, '');

  const commandFixture = url.fileURLToPath(new URL('./fixtures/currency-schedule/command.ts', import.meta.url));
  await Promise.all(
    ['uname', 'id', 'date', 'launchctl', 'sudo', 'plutil'].map(name =>
      fs.writeFile(
        path.join(root, 'bin', name),
        '#!/bin/sh\nexec "$CURRENCY_TEST_NODE" "$CURRENCY_TEST_COMMAND" "$0" "$@"\n',
        { mode: 0o755 },
      ),
    ),
  );
  await fs.symlink(process.execPath, path.join(root, 'bin/node'));
  await fs.copyFile(
    url.fileURLToPath(new URL('./fixtures/currency-schedule/collector.ts', import.meta.url)),
    path.join(root, 'server/scripts/fetch-daily-currencies.ts'),
  );
  await fs.copyFile(
    url.fileURLToPath(new URL('./validate-currency-schedule.ts', import.meta.url)),
    path.join(root, 'scripts/validate-currency-schedule.ts'),
  );

  const env = {
    ...process.env,
    HOME: root,
    PATH: `${path.join(root, 'bin')}:/usr/bin:/bin`,
    TZ: 'Europe/Amsterdam',
    CURRENCY_TEST_ROOT: root,
    CURRENCY_TEST_NODE: process.execPath,
    CURRENCY_TEST_COMMAND: commandFixture,
  };

  function invoke(args: string[], overrides: Record<string, string> = {}) {
    return childProcess.spawnSync('/bin/bash', [script, ...args], {
      env: { ...env, ...overrides },
      encoding: 'utf8',
      timeout: 10_000,
    });
  }

  async function commands() {
    return z.array(z.array(z.string())).parse(
      (await fs.readFile(calls, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line)),
    );
  }

  return { root, envFile, installed, loaded, collected, invoke, commands };
}

it('previews an escaped 17:15 regular-user plist without credentials or installation', async t => {
  const f = await fixture(t);
  const result = f.invoke(['preview', f.envFile]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('<key>UserName</key><string>tcg-user</string>');
  expect(result.stdout).toContain('<key>Hour</key><integer>17</integer><key>Minute</key><integer>15</integer>');
  expect(result.stdout).toContain(f.envFile.replaceAll('&', '&amp;'));
  expect(result.stdout).toContain('<string>/bin/bash</string>');
  expect(result.stdout).not.toContain('fixture-secret');
  expect(result.stdout).not.toContain('RunAtLoad');
  expect(await f.commands()).toEqual([]);
});

it('replaces the same root-owned job without duplication and preserves configuration and logs on removal', async t => {
  const f = await fixture(t);
  expect(f.invoke(['install', f.envFile]).status).toBe(0);
  expect(f.invoke(['install', f.envFile]).status).toBe(0);
  expect(await fs.readFile(f.installed, 'utf8')).toContain('com.tcg.daily-currencies');
  expect((await f.commands()).filter(command => command.includes('bootout'))).toHaveLength(1);
  expect(await f.commands()).toContainEqual([
    'sudo',
    '/usr/bin/install',
    '-o',
    'root',
    '-g',
    'wheel',
    '-m',
    '644',
    expect.any(String),
    '/Library/LaunchDaemons/com.tcg.daily-currencies.plist',
  ]);
  expect(f.invoke(['uninstall']).status).toBe(0);
  expect(await fs.readFile(f.envFile, 'utf8')).toContain('fixture-secret');
  expect((await fs.stat(path.join(f.root, 'Library/Logs/TCG'))).isDirectory()).toBe(true);
  await expect(fs.stat(f.installed)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects missing environment files before executing system commands', async t => {
  const f = await fixture(t);
  expect(f.invoke(['install', path.join(f.root, 'missing.env')]).status).toBe(1);
  expect(await f.commands()).toEqual([]);
});

it('rejects DEBUG=false because the collector would enable query logging', async t => {
  const f = await fixture(t);
  await fs.appendFile(f.envFile, 'DEBUG=false\n');
  const result = f.invoke(['install', f.envFile]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Omit DEBUG');
  expect(await f.commands()).toEqual([]);
});

it('rejects shared-readable environment files before executing system commands', async t => {
  const f = await fixture(t);
  await fs.chmod(f.envFile, 0o644);
  expect(f.invoke(['install', f.envFile]).status).toBe(1);
  expect(await f.commands()).toEqual([]);
});

it('rejects invalid configuration without exposing credentials', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.envFile, 'DATABASE_URL=fixture-secret\n');
  const result = f.invoke(['install', f.envFile]);
  expect(result.status).toBe(1);
  expect(result.stderr).not.toContain('fixture-secret');
  expect(await f.commands()).toEqual([]);
});

it('rejects timezones outside Amsterdam and Berlin before installation', async t => {
  const f = await fixture(t);
  expect(f.invoke(['install', f.envFile], { TZ: 'America/New_York' }).status).toBe(1);
  expect(await f.commands()).toEqual([]);
});

it('rejects non-macOS hosts before executing system commands', async t => {
  const f = await fixture(t);
  expect(f.invoke(['install', f.envFile], { CURRENCY_TEST_PLATFORM: 'Linux' }).status).toBe(1);
  expect(await f.commands()).toEqual([]);
});

it('rejects root installations', async t => {
  const f = await fixture(t);
  expect(f.invoke(['install', f.envFile], { CURRENCY_TEST_UID: '0' }).status).toBe(1);
  expect(await f.commands()).toEqual([]);
});

it.for(['/usr/bin/install', 'bootstrap'])('surfaces a failure in %s without reporting success', async (failure, t) => {
  const f = await fixture(t);
  const result = f.invoke(['install', f.envFile], { CURRENCY_TEST_FAILURE: failure });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Administrative command failed');
  expect(result.stdout).not.toContain('Installed daily currency collection');
});

it('skips early wake-ups without invoking the collector', async t => {
  const f = await fixture(t);
  expect(f.invoke(['run', f.envFile, process.execPath], { CURRENCY_TEST_TIME: '1714' }).status).toBe(0);
  await expect(fs.stat(f.collected)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('runs the collector at 17:15 with the explicit environment file and no inherited DEBUG', async t => {
  const f = await fixture(t);
  expect(f.invoke(['run', f.envFile, process.execPath], { DEBUG: 'true', DATABASE_URL: 'wrong' }).status).toBe(0);
  expect(JSON.parse(await fs.readFile(f.collected, 'utf8'))).toEqual({
    database: 'postgresql://tcg:fixture-secret@db/tcg',
    mode: 'production',
    cwd: path.join(f.root, 'server'),
  });
});

it('propagates collector failures to launchd', async t => {
  const f = await fixture(t);
  await fs.appendFile(f.envFile, 'COLLECTOR_TEST_EXIT=1\n');
  expect(f.invoke(['run', f.envFile, process.execPath]).status).toBe(1);
});

it('shows launchctl status without changing the installed job', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.loaded, 'loaded');
  const result = f.invoke(['status']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('last exit code = 0');
  expect(await f.commands()).toEqual([['launchctl', 'print', 'system/com.tcg.daily-currencies']]);
});

it('can uninstall an absent job without deleting credentials', async t => {
  const f = await fixture(t);
  expect(f.invoke(['uninstall']).status).toBe(0);
  expect(await fs.readFile(f.envFile, 'utf8')).toContain('fixture-secret');
  expect(await f.commands()).toContainEqual([
    'sudo',
    '/bin/rm',
    '-f',
    '/Library/LaunchDaemons/com.tcg.daily-currencies.plist',
  ]);
});

import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { expect, test, type TestContext } from 'vitest';
import z from 'zod';

const script = url.fileURLToPath(new URL('./build-server-image.ts', import.meta.url));

interface DockerConfigFixture {
  credsStore?: string;
  credHelpers?: Record<string, string>;
  auths?: Record<string, { auth: string }>;
  proxies?: Record<string, { httpProxy: string }>;
  currentContext?: string;
  futureSetting?: { enabled: boolean };
}

const ObservationSchema = z.object({
  directory: z.string(),
  config: z.record(z.string(), z.unknown()),
  context: z.string().optional(),
  mode: z.number(),
  configMode: z.number().optional(),
  args: z.array(z.string()),
  cwd: z.string(),
});

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'server-image-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const dockerConfig = path.join(root, 'docker-config');
  const bin = path.join(root, 'bin');
  const temporary = path.join(root, 'tmp');
  const observation = path.join(root, 'observation.json');
  await Promise.all([dockerConfig, bin, temporary].map(dirPath => fs.mkdir(dirPath)));
  const executable = path.join(bin, 'docker');
  await fs.writeFile(
    executable,
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const directory = process.env.DOCKER_CONFIG || path.join(process.env.HOME, '.docker');
const file = path.join(directory, 'config.json');
const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const context = path.join(directory, 'contexts', 'fixture');
fs.writeFileSync(process.env.OBSERVATION, JSON.stringify({
  directory, config, mode: fs.statSync(directory).mode & 0o777,
  configMode: fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : undefined,
  context: fs.existsSync(context) ? fs.readFileSync(context, 'utf8') : undefined,
  args: process.argv.slice(2), cwd: process.cwd(),
}));
console.log('docker output');
process.exit(Number(process.env.DOCKER_EXIT || 0));
`,
    { mode: 0o755 },
  );

  const env = {
    ...process.env,
    PATH: bin,
    HOME: root,
    DOCKER_CONFIG: dockerConfig,
    TCG_DEVCONTAINER: '1',
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    OBSERVATION: observation,
  };

  return {
    root,
    dockerConfig,
    executable,
    temporary,
    env,
    write: (value: DockerConfigFixture) => {
      return fs.writeFile(path.join(dockerConfig, 'config.json'), JSON.stringify(value));
    },
    observe: async () => ObservationSchema.parse(JSON.parse(await fs.readFile(observation, 'utf8'))),
    run: (overrides: NodeJS.ProcessEnv = {}) => {
      return childProcess.spawnSync(process.execPath, [script], { env: { ...env, ...overrides }, encoding: 'utf8' });
    },
  };
}

test('builds with an isolated editor-free config while preserving credentials and supporting files', async t => {
  const f = await fixture(t);

  const original = {
    credsStore: 'dev-containers-session',
    credHelpers: { 'ghcr.io': 'dev-containers-session', 'private.example.com': 'pass' },
    auths: { 'ghcr.io': { auth: 'fixture-credential' } },
    proxies: { default: { httpProxy: 'http://proxy.example.com' } },
    currentContext: 'fixture',
    futureSetting: { enabled: true },
  };

  await f.write(original);
  const source = await fs.readFile(path.join(f.dockerConfig, 'config.json'), 'utf8');
  await fs.mkdir(path.join(f.dockerConfig, 'contexts'));
  await fs.writeFile(path.join(f.dockerConfig, 'contexts', 'fixture'), 'context-data');

  const result = f.run();
  const observed = await f.observe();

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('docker output');
  expect(observed.directory).not.toBe(f.dockerConfig);
  expect(observed.config).toEqual({
    ...original,
    credsStore: undefined,
    credHelpers: { 'private.example.com': 'pass' },
  });
  expect(observed.context).toBe('context-data');
  expect(observed.mode).toBe(0o700);
  expect(observed.configMode).toBe(0o600);
  expect(observed.args).toEqual([
    'build',
    '--build-arg',
    'NODE_VERSION=26',
    '--build-arg',
    'PNPM_VERSION=12.5.1',
    '--tag',
    'tcg-server:local',
    '.',
  ]);
  expect(observed.cwd).toBe(path.dirname(path.dirname(script)));
  expect(await fs.readFile(path.join(f.dockerConfig, 'config.json'), 'utf8')).toBe(source);
  expect(await fs.readdir(f.temporary)).toEqual([]);
});

test('preserves a normal default helper when removing a registry-specific editor helper', async t => {
  const f = await fixture(t);
  await f.write({ credsStore: 'pass', credHelpers: { 'ghcr.io': 'dev-containers-session' } });

  expect(f.run().status).toBe(0);
  expect((await f.observe()).config).toEqual({ credsStore: 'pass', credHelpers: {} });
  expect(await fs.readdir(f.temporary)).toEqual([]);
});

test('leaves host authentication unchanged even with an editor helper configured', async t => {
  const f = await fixture(t);
  const config = { credsStore: 'dev-containers-session' };
  await f.write(config);

  expect(f.run({ TCG_DEVCONTAINER: '' }).status).toBe(0);
  expect((await f.observe()).directory).toBe(f.dockerConfig);
  expect((await f.observe()).config).toEqual(config);
  expect(await fs.readdir(f.temporary)).toEqual([]);
});

test('uses normal helper configuration unchanged inside the devcontainer', async t => {
  const f = await fixture(t);
  const config = { credsStore: 'pass', credHelpers: { 'ghcr.io': 'secretservice' } };
  await f.write(config);

  expect(f.run().status).toBe(0);
  expect((await f.observe()).directory).toBe(f.dockerConfig);
  expect((await f.observe()).config).toEqual(config);
  expect(await fs.readdir(f.temporary)).toEqual([]);
});

test('builds normally when no Docker configuration exists', async t => {
  const f = await fixture(t);

  expect(f.run().status).toBe(0);
  expect((await f.observe()).directory).toBe(f.dockerConfig);
  expect((await f.observe()).config).toEqual({});
  expect(await fs.readdir(f.temporary)).toEqual([]);
});

test('uses the home Docker directory when DOCKER_CONFIG is unset', async t => {
  const f = await fixture(t);
  await f.write({ credsStore: 'dev-containers-session' });
  await fs.rename(f.dockerConfig, path.join(f.root, '.docker'));

  expect(f.run({ DOCKER_CONFIG: undefined }).status).toBe(0);
  expect((await f.observe()).config).toEqual({});
  expect(await fs.readdir(f.temporary)).toEqual([]);
});

test('cleans up temporary configuration before returning a Docker failure', async t => {
  const f = await fixture(t);
  await f.write({ credsStore: 'dev-containers-session' });

  const result = f.run({ DOCKER_EXIT: '42' });

  expect(result.status).toBe(42);
  expect(result.stdout).toContain('docker output');
  expect((await f.observe()).config).toEqual({});
  expect(await fs.readdir(f.temporary)).toEqual([]);
});

test('cleans up temporary configuration when Docker cannot be spawned', async t => {
  const f = await fixture(t);
  await f.write({ credsStore: 'dev-containers-session' });
  await fs.unlink(f.executable);

  const result = f.run();

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('ENOENT');
  expect(await fs.readdir(f.temporary)).toEqual([]);
});

test('rejects malformed JSON without printing its credential contents', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dockerConfig, 'config.json'), '{"auths":"fixture-secret"');

  const result = f.run();

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Invalid Docker configuration');
  expect(result.stderr).not.toContain('fixture-secret');
  await expect(fs.access(path.join(f.root, 'observation.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readdir(f.temporary)).toEqual([]);
});

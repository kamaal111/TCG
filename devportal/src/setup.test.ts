import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { readPortalSettings, savePortalSettings } from './config.ts';
import { setupDevportal } from './setup.ts';
import { parseServeConfiguration } from './tailscale.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';
import type { Prompts } from '../../scripts/infra/prompts.ts';
import { acquireReleaseLock } from '../../scripts/release/lock.ts';

const root = url.fileURLToPath(new URL('../../', import.meta.url));
const hostname = 'release.example.ts.net';

const identity = {
  BackendState: 'Running',
  Self: { DNSName: `${hostname}.`, UserID: 1, TailscaleIPs: ['100.64.0.10'] },
  User: { '1': { LoginName: 'operator@example.com' } },
};

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mintomo setup-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'key'), 'test key');
  await fs.writeFile(path.join(directory, 'known-hosts'), 'test known hosts');
  await fs.writeFile(
    path.join(directory, 'release.env'),
    [
      'TCG_DEPLOY_HOST=100.64.0.20',
      `TCG_DEPLOY_KEY="${path.join(directory, 'key')}"`,
      `TCG_KNOWN_HOSTS="${path.join(directory, 'known-hosts')}"`,
      'TCG_IMAGE_REPOSITORY=ghcr.io/example/server',
      '',
    ].join('\n'),
  );

  const commands: string[][] = [];
  const notes: string[] = [];
  const questions: string[] = [];
  const installed: string[] = [];

  const state = {
    serve: parseServeConfiguration('{}'),
    identity,
    approve: true,
    failServe: false,
    changeDuringReview: false,
    answers: new Array<string>(),
  };

  const prompts: Prompts = {
    text: async question => {
      questions.push(question.initialValue ?? '');

      return state.answers.shift() ?? question.initialValue ?? '';
    },
    password: async () => '',
    select: async () => '',
    multiselect: async () => [],
    confirm: async () => {
      if (state.changeDuringReview) {
        state.serve = { TCP: { '443': { TCPForward: 'localhost:1234' } } };
      }

      return state.approve;
    },
    note: message => {
      notes.push(message);
    },
  };

  const options = {
    root,
    configDirectory: directory,
    tailscale: 'tailscale',
    prompts,
    installAgent: async (config: string) => {
      installed.push(config);
    },
    commands: {
      read: (program: string, args: string[]) => {
        commands.push([program, ...args]);

        if (program === 'tailscale' && args[0] === 'status') {
          return JSON.stringify(state.identity);
        }

        return JSON.stringify(state.serve);
      },
      run: (program: string, args: string[]) => {
        commands.push([program, ...args]);

        if (state.failServe) {
          throw new InfraFailure('Tailscale needs administrator approval. Rerun just setup-devportal.');
        }

        const port = args.find(arg => arg.startsWith('--https='))?.split('=')[1];

        if (program === 'tailscale' && port) {
          state.serve = {
            ...state.serve,
            TCP: { ...state.serve.TCP, [port]: { HTTPS: true } },
            Web: { ...state.serve.Web, [`${hostname}:${port}`]: { Handlers: { '/': { Proxy: args.at(-1) } } } },
          };
        }
      },
    },
  };

  return { directory, commands, notes, questions, installed, state, options };
}

test('guides first setup, persists private settings and prints the app connection URL without releasing', async () => {
  const f = await fixture();
  await setupDevportal(f.options);
  expect(await readPortalSettings(f.directory)).toEqual({ allowedLogins: ['operator@example.com'], port: 8787 });
  expect((await fs.stat(path.join(f.directory, 'devportal.json'))).mode & 0o777).toBe(0o600);
  expect(f.installed).toEqual([f.directory]);
  expect(f.commands).toContainEqual(['tailscale', 'serve', '--bg', '--https=443', 'http://127.0.0.1:8787']);
  expect(f.commands.flat()).not.toContain('release-server');
  expect(f.commands.flat()).not.toContain('funnel');
  expect(f.notes.at(-1)).toContain(`Paste https://${hostname}`);
  await expect(fs.access(path.join(f.directory, 'release.lock'))).rejects.toThrow('ENOENT');
});

test('reuses saved users and local port on rerun', async () => {
  const f = await fixture();
  await savePortalSettings(f.directory, { allowedLogins: ['teammate@example.com'], port: 8888 });
  await setupDevportal(f.options);
  await setupDevportal(f.options);
  expect(f.questions).toEqual(['teammate@example.com', '8888', 'teammate@example.com', '8888']);
  expect(f.commands).toContainEqual(['tailscale', 'serve', '--bg', '--https=443', 'http://127.0.0.1:8888']);
});

test('saves edited, deduplicated accounts and preserves another service by choosing a separate HTTPS port', async () => {
  const f = await fixture();
  f.state.answers.push(' operator@example.com, teammate@example.com, operator@example.com ', '8888');
  f.state.serve = { TCP: { '443': { TCPForward: 'localhost:1234' } } };
  await setupDevportal(f.options);
  expect(await readPortalSettings(f.directory)).toEqual({
    allowedLogins: ['operator@example.com', 'teammate@example.com'],
    port: 8888,
  });
  expect(f.state.serve.TCP?.['443']).toEqual({ TCPForward: 'localhost:1234' });
  expect(f.commands).toContainEqual(['tailscale', 'serve', '--bg', '--https=8443', 'http://127.0.0.1:8888']);
  expect(f.notes.at(-1)).toContain(`Paste https://${hostname}:8443`);
});

test('cancelling the review preserves existing settings and does not install or configure services', async () => {
  const f = await fixture();
  const existing = '{"allowedLogins":["operator@example.com"],"port":8888}\n';
  await fs.writeFile(path.join(f.directory, 'devportal.json'), existing);
  f.state.approve = false;
  await setupDevportal(f.options);
  expect(await fs.readFile(path.join(f.directory, 'devportal.json'), 'utf8')).toBe(existing);
  expect(f.installed).toEqual([]);
  expect(f.commands).not.toContainEqual(['tailscale', 'serve', '--bg', '--https=443', 'http://127.0.0.1:8888']);
});

test('a running release blocks settings writes and agent restart', async () => {
  const f = await fixture();
  const unlock = await acquireReleaseLock(f.directory);
  onTestFinished(unlock);
  await expect(setupDevportal(f.options)).rejects.toThrow('Another release is running');
  await expect(fs.access(path.join(f.directory, 'devportal.json'))).rejects.toThrow('ENOENT');
  expect(f.installed).toEqual([]);
});

test('changed listeners require a fresh review before any portal settings are written', async () => {
  const f = await fixture();
  f.state.changeDuringReview = true;
  await expect(setupDevportal(f.options)).rejects.toThrow('listeners changed during review');
  expect(f.installed).toEqual([]);
  await expect(fs.access(path.join(f.directory, 'devportal.json'))).rejects.toThrow('ENOENT');
});

test('a failed HTTPS step keeps completed settings and releases the lock for retry', async () => {
  const f = await fixture();
  f.state.failServe = true;
  await expect(setupDevportal(f.options)).rejects.toThrow('Rerun just setup-devportal');
  expect(await readPortalSettings(f.directory)).toEqual({ allowedLogins: ['operator@example.com'], port: 8787 });
  await expect(fs.access(path.join(f.directory, 'release.lock'))).rejects.toThrow('ENOENT');

  f.state.failServe = false;
  await setupDevportal(f.options);
  expect(f.notes.at(-1)).toContain('Paste https://');
});

test('invalid existing settings remain intact and stop installation', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.directory, 'devportal.json'), '{broken');
  await expect(setupDevportal(f.options)).rejects.toThrow('invalid or unreadable');
  expect(await fs.readFile(path.join(f.directory, 'devportal.json'), 'utf8')).toBe('{broken');
  expect(f.installed).toEqual([]);
});

test('missing release credentials open the existing setup-infra flow and revalidate its output', async () => {
  const f = await fixture();
  await fs.rm(path.join(f.directory, 'release.env'));
  await expect(setupDevportal(f.options)).rejects.toThrow('Run just setup-infra first');
  expect(f.commands).toContainEqual(['just', 'setup-infra', '--config-dir', f.directory]);
  expect(f.installed).toEqual([]);
});

test('validates saved credentials independently of exports that the login service will not inherit', async () => {
  const f = await fixture();
  vi.stubEnv('TCG_DEPLOY_HOST', 'invalid exported hostname');
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  await setupDevportal(f.options);
  expect(f.installed).toEqual([f.directory]);
  expect(f.commands).not.toContainEqual(['just', 'setup-infra', '--config-dir', f.directory]);
});

test('help works without a terminal and explains that setup never starts a release', () => {
  const result = childProcess.spawnSync(process.execPath, [path.join(root, 'devportal/src/setup-cli.ts'), '--help'], {
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Usage: just setup-devportal');
  expect(result.stdout).toContain('No release is started.');
});

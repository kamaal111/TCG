import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readPortalSettings, savePortalSettings } from './config.ts';
import { installDevportalAgent } from './install.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';
import { acquireLocalLease, acquireReleaseLock } from '../../scripts/release/lock.ts';

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mintomo agent update-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  const origin = path.join(directory, 'origin');
  const publisher = path.join(directory, 'publisher');
  const checkout = path.join(directory, 'checkout');
  const configDirectory = path.join(directory, 'private settings');

  const git = (args: string[], cwd = checkout) => {
    return childProcess.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  };

  await fs.mkdir(publisher);
  git(['init', '--bare', origin], directory);
  git(['init', '-b', 'main'], publisher);
  git(['config', 'user.name', 'Installer Test'], publisher);
  git(['config', 'user.email', 'installer@example.com'], publisher);
  await fs.writeFile(path.join(publisher, 'service.txt'), 'original service');
  git(['add', '.'], publisher);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Initial service'], publisher);
  git(['remote', 'add', 'origin', origin], publisher);
  git(['push', '-u', 'origin', 'main'], publisher);
  git(['clone', '-b', 'main', origin, checkout], directory);
  git(['config', 'user.name', 'Installer Test']);
  git(['config', 'user.email', 'installer@example.com']);
  const previous = git(['rev-parse', 'HEAD']);
  await fs.writeFile(path.join(publisher, 'service.txt'), 'updated service');
  git(['add', '.'], publisher);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Update service'], publisher);
  git(['push', 'origin', 'main'], publisher);
  const latest = git(['rev-parse', 'HEAD'], publisher);
  await savePortalSettings(configDirectory, { allowedLogins: ['operator@example.com'], port: 8888 });
  await fs.writeFile(path.join(configDirectory, 'history.json'), '{"preserved":true}');
  const calls: string[][] = [];
  const state = { failDependencies: false, applied: false };

  const options = {
    configDirectory,
    installed: true,
    stop: async () => {
      calls.push(['stop']);
    },
    commands: {
      read: (program: string, args: string[]) => {
        calls.push([program, ...args]);

        return childProcess.execFileSync(program, args, {
          cwd: checkout,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      },
      run: (program: string, args: string[]) => {
        calls.push([program, ...args]);

        if (program === 'git') {
          git(args);
        }

        if (args.includes('install-js-modules') && state.failDependencies) {
          throw new InfraFailure('Dependencies failed. Rerun just install-devportal-agent.');
        }

        if (args.includes('server/devportal/agent-service-cli.ts')) {
          state.applied = true;
        }
      },
    },
  };

  return { options, calls, state, directory, origin, checkout, configDirectory, git, previous, latest };
}

test('updates merged main, refreshes dependencies and restarts the fetched installer without setup prompts', async () => {
  const f = await fixture();
  await installDevportalAgent(f.options);
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.latest);
  expect(await fs.readFile(path.join(f.checkout, 'service.txt'), 'utf8')).toBe('updated service');
  expect(f.calls).toContainEqual(['stop']);
  expect(f.calls.findIndex(call => call[0] === 'stop')).toBeLessThan(f.calls.findIndex(call => call.includes('merge')));
  expect(f.calls).toContainEqual(['mise', 'install']);
  expect(f.calls).toContainEqual(['mise', 'exec', '--', 'just', 'install-js-modules', '--frozen-lockfile']);
  expect(f.calls).toContainEqual([
    'mise',
    'exec',
    '--',
    'node',
    'server/devportal/agent-service-cli.ts',
    'install',
    '--config-dir',
    f.configDirectory,
  ]);
  expect(f.calls.flat()).not.toContain('setup-devportal');
  expect(f.calls.flat()).not.toContain('release-server');
  expect(f.state.applied).toBe(true);
  expect(await readPortalSettings(f.configDirectory)).toEqual({ allowedLogins: ['operator@example.com'], port: 8888 });
  expect(await fs.readFile(path.join(f.configDirectory, 'history.json'), 'utf8')).toBe('{"preserved":true}');
  await expect(fs.access(path.join(f.configDirectory, 'release.lock'))).rejects.toThrow('ENOENT');
  await expect(fs.access(path.join(f.configDirectory, 'devportal.lock'))).rejects.toThrow('ENOENT');
});

test('rerunning an up-to-date installation refreshes and restarts it successfully', async () => {
  const f = await fixture();
  await installDevportalAgent(f.options);
  await installDevportalAgent(f.options);
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.latest);
  expect(f.calls.filter(call => call.includes('server/devportal/agent-service-cli.ts'))).toHaveLength(2);
});

test('first installation opens the existing wizard instead of duplicating setup', async () => {
  const f = await fixture();
  await fs.rm(path.join(f.configDirectory, 'devportal.json'));
  f.options.installed = false;
  await installDevportalAgent(f.options);
  expect(f.calls).toEqual([['just', 'setup-devportal', '--config-dir', f.configDirectory]]);
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.previous);
});

test('a running release prevents fetching, stopping or changing the service', async () => {
  const f = await fixture();
  const unlock = await acquireReleaseLock(f.configDirectory);
  onTestFinished(unlock);
  await expect(installDevportalAgent(f.options)).rejects.toThrow('Another release is running');
  expect(f.calls).toEqual([]);
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.previous);
});

test('local edits leave the running service and checkout intact', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.checkout, 'service.txt'), 'local edit');
  await expect(installDevportalAgent(f.options)).rejects.toThrow('local changes');
  expect(f.calls).not.toContainEqual(['stop']);
  expect(await fs.readFile(path.join(f.checkout, 'service.txt'), 'utf8')).toBe('local edit');
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.previous);
});

test('an unrelated development branch leaves the running service untouched', async () => {
  const f = await fixture();
  f.git(['switch', '-c', 'feature/local-work']);
  await expect(installDevportalAgent(f.options)).rejects.toThrow('persistent main checkout');
  expect(f.calls).not.toContainEqual(['stop']);
  expect(f.git(['branch', '--show-current'])).toBe('feature/local-work');
});

test('divergent local commits are preserved and never reset or merged', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.checkout, 'local.txt'), 'local work');
  f.git(['add', '.']);
  f.git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Keep local work']);
  const local = f.git(['rev-parse', 'HEAD']);
  await expect(installDevportalAgent(f.options)).rejects.toThrow('cannot fast-forward');
  expect(f.calls).not.toContainEqual(['stop']);
  expect(f.git(['rev-parse', 'HEAD'])).toBe(local);
});

test('a failed dependency refresh preserves settings and can be retried with the same command', async () => {
  const f = await fixture();
  f.state.failDependencies = true;
  await expect(installDevportalAgent(f.options)).rejects.toThrow('Rerun just install-devportal-agent');
  expect(f.state.applied).toBe(false);
  expect(await readPortalSettings(f.configDirectory)).toEqual({ allowedLogins: ['operator@example.com'], port: 8888 });
  await expect(fs.access(path.join(f.configDirectory, 'release.lock'))).rejects.toThrow('ENOENT');
  await expect(fs.access(path.join(f.configDirectory, 'devportal.lock'))).rejects.toThrow('ENOENT');

  f.state.failDependencies = false;
  await installDevportalAgent(f.options);
  expect(f.state.applied).toBe(true);
});

test('waits for the stopped agent to release its service lease before updating files', async () => {
  const f = await fixture();
  const unlockService = await acquireLocalLease(f.configDirectory, 'devportal');
  f.options.stop = async () => {
    f.calls.push(['stop']);
    await unlockService();
  };

  await installDevportalAgent(f.options);
  expect(f.state.applied).toBe(true);
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.latest);
});

test('concurrent local edits during shutdown are preserved before changing tracked files', async () => {
  const f = await fixture();
  f.options.stop = async () => {
    await fs.writeFile(path.join(f.checkout, 'service.txt'), 'concurrent local work');
  };

  await expect(installDevportalAgent(f.options)).rejects.toThrow('checkout changed');
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.previous);
  expect(await fs.readFile(path.join(f.checkout, 'service.txt'), 'utf8')).toBe('concurrent local work');
  expect(f.state.applied).toBe(false);
});

test('an agent that fails to stop prevents updating files', { timeout: 20_000 }, async () => {
  const f = await fixture();
  const unlockService = await acquireLocalLease(f.configDirectory, 'devportal');
  onTestFinished(unlockService);
  await expect(installDevportalAgent(f.options)).rejects.toThrow('has not stopped');
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.previous);
  expect(f.state.applied).toBe(false);
  await expect(fs.access(path.join(f.configDirectory, 'release.lock'))).rejects.toThrow('ENOENT');
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { TestContext } from 'vitest';

import { appFingerprint, saveAppSettings } from './config.ts';
import { lastAppUpload, releaseAppFromTerminal } from './runtime.ts';
import type { Command } from './xcode.ts';
import { InfraFailure } from '../infra/errors.ts';
import type { Prompts } from '../infra/prompts.ts';

const sha = 'a'.repeat(40);
const settings = { version: 1, teamID: 'DXUKH9VF73', apiHost: 'api.mintomo.com' } as const;

async function fixture(t: TestContext, failure?: 'checks' | 'upload') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-runtime-'));
  t.onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  await saveAppSettings(directory, settings);

  const command = vi.fn<Command>(async (program, args) => {
    if (program === 'just' && failure === 'checks') {
      throw new InfraFailure('Verification failed.');
    }

    if (program === 'xcodebuild' && args[0] === '-exportArchive' && failure === 'upload') {
      throw new InfraFailure('Upload connection lost.');
    }

    if (program === 'git' && args[0] === 'rev-parse') {
      return sha;
    }

    if (program === 'git' && args[0] === 'show') {
      return 'MARKETING_VERSION = 1.0';
    }

    if (program === 'plutil' && args.at(-1)?.endsWith('Mintomo.xcarchive/Info.plist')) {
      return JSON.stringify({ ApplicationProperties: { ApplicationPath: 'Applications/Mintomo.app' } });
    }

    if (program === 'plutil') {
      return JSON.stringify({
        CFBundleIdentifier: 'io.kamaal.TCG',
        CFBundleShortVersionString: '1.0',
        CFBundleSupportedPlatforms: ['iPhoneOS'],
        TCGAPIBaseURL: 'https://api.mintomo.com',
        TCGAPIEnvironment: 'remote',
      });
    }

    return '';
  });

  const confirm = vi.fn<Prompts['confirm']>().mockResolvedValue(true);

  const prompts: Prompts = {
    confirm,
    text: vi.fn<Prompts['text']>(),
    password: vi.fn<Prompts['password']>(),
    select: vi.fn<Prompts['select']>(),
    multiselect: vi.fn<Prompts['multiselect']>(),
    note: vi.fn<Prompts['note']>(),
  };

  const options = {
    root: directory,
    configDirectory: directory,
    platform: 'ios',
    revision: 'origin/main',
    command,
    prompts,
  } as const;

  return { directory, command, confirm, prompts, options };
}

test('checks, signs and uploads once, records success and prevents identical reupload', async t => {
  const f = await fixture(t);
  await releaseAppFromTerminal(f.options);
  expect(f.confirm.mock.calls.map(call => call[2]?.kind)).toEqual(['provision', 'upload']);
  expect(f.command.mock.calls.map(call => [call[0], call[1][0]])).toContainEqual(['just', 'ready-app']);
  expect(f.command.mock.calls.filter(call => call[1][0] === '-exportArchive')).toHaveLength(1);
  expect(await lastAppUpload(f.directory, 'ios')).toMatchObject({ sha, state: 'uploaded' });
  expect(await lastAppUpload(f.directory, 'macos')).toBeNull();
  await expect(releaseAppFromTerminal(f.options)).rejects.toThrow('already uploaded');
  expect(f.command.mock.calls.filter(call => call[1][0] === '-exportArchive')).toHaveLength(1);
  await expect(fs.access(path.join(f.directory, 'app-release.lock'))).rejects.toThrow('ENOENT');
});

test('declining upload retains the archive without an upload or successful history', async t => {
  const f = await fixture(t);
  f.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(releaseAppFromTerminal(f.options)).rejects.toThrow('cancelled before upload');
  expect(f.command.mock.calls.filter(call => call[1][0] === '-exportArchive')).toHaveLength(0);
  expect(await lastAppUpload(f.directory, 'ios')).toBeNull();
  expect(f.command.mock.calls.some(call => call[1][0] === 'worktree' && call[1][1] === 'remove')).toBe(true);
});

test('stale review fails before verification or signing', async t => {
  const f = await fixture(t);
  await expect(releaseAppFromTerminal({ ...f.options, reviewedFingerprint: 'stale' })).rejects.toThrow('changed');
  expect(f.confirm).not.toHaveBeenCalled();
  expect(f.command.mock.calls.some(call => call[0] === 'xcodebuild')).toBe(false);
});

test('a settings change during upload approval prevents the upload', async t => {
  const f = await fixture(t);
  f.confirm.mockResolvedValueOnce(true).mockImplementationOnce(async () => {
    await saveAppSettings(f.directory, { ...settings, apiHost: 'new.mintomo.com' });

    return true;
  });
  await expect(
    releaseAppFromTerminal({ ...f.options, reviewedFingerprint: appFingerprint('ios', sha, settings) }),
  ).rejects.toThrow('changed');
  expect(f.command.mock.calls.filter(call => call[1][0] === '-exportArchive')).toHaveLength(0);
});

test('failed verification prevents signing and upload', async t => {
  const f = await fixture(t, 'checks');
  await expect(releaseAppFromTerminal(f.options)).rejects.toThrow('Verification failed');
  expect(f.command.mock.calls.some(call => call[0] === 'xcodebuild')).toBe(false);
});

test('upload failure does not retry or record a successful upload', async t => {
  const f = await fixture(t, 'upload');
  await expect(releaseAppFromTerminal(f.options)).rejects.toThrow('Upload connection lost');
  expect(f.command.mock.calls.filter(call => call[1][0] === '-exportArchive')).toHaveLength(1);
  expect(await lastAppUpload(f.directory, 'ios')).toBeNull();
  await expect(fs.access(path.join(f.directory, 'app-release.lock'))).rejects.toThrow('ENOENT');
});

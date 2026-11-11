import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { TestContext } from 'vitest';

import { appFingerprint, saveAppSettings, type Platform } from './config.ts';
import { lastAppUpload, releaseAppFromTerminal } from './runtime.ts';
import type { Command } from './xcode.ts';
import { InfraFailure } from '../infra/errors.ts';
import type { Prompts } from '../infra/prompts.ts';

const sha = 'a'.repeat(40);
const settings = { version: 1, teamID: 'DXUKH9VF73', apiHost: 'api.mintomo.com' } as const;

async function fixture(t: TestContext, failure?: 'archive' | 'upload', platform: Platform = 'ios') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-runtime-'));
  t.onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  await saveAppSettings(directory, settings);

  const command = vi.fn<Command>(async (program, args) => {
    if (program === 'xcodebuild' && args.includes('archive') && failure === 'archive') {
      throw new InfraFailure('Archive failed.');
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
        CFBundleSupportedPlatforms: [platform === 'ios' ? 'iPhoneOS' : 'MacOSX'],
        TCGAPIBaseURL: 'https://api.mintomo.com',
        TCGAPIEnvironment: 'remote',
      });
    }

    return '';
  });

  const confirm = vi.fn<Prompts['confirm']>().mockResolvedValue(true);
  const note = vi.fn<Prompts['note']>();

  const prompts: Prompts = {
    confirm,
    text: vi.fn<Prompts['text']>(),
    password: vi.fn<Prompts['password']>(),
    select: vi.fn<Prompts['select']>(),
    multiselect: vi.fn<Prompts['multiselect']>(),
    note,
  };

  const options = {
    root: directory,
    configDirectory: directory,
    platform,
    revision: 'origin/main',
    command,
    prompts,
  } as const;

  return { directory, command, confirm, note, prompts, options };
}

test('signs and uploads previously verified source without dependency installation or tests', async t => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  t.onTestFinished(() => clock.mockRestore());
  const f = await fixture(t);
  await releaseAppFromTerminal(f.options);
  expect(f.confirm.mock.calls.map(call => call[2]?.kind)).toEqual(['provision', 'upload']);
  expect(f.command.mock.calls.some(call => ['just', 'mise', 'pnpm'].includes(call[0]))).toBe(false);
  expect(f.command.mock.calls.some(call => call[0] === 'xcodebuild' && call[1].includes('test'))).toBe(false);
  expect(f.command.mock.calls.filter(call => call[1][0] === '-exportArchive')).toHaveLength(1);
  expect(await lastAppUpload(f.directory, 'ios')).toMatchObject({ sha, state: 'uploaded' });
  expect(await lastAppUpload(f.directory, 'macos')).toBeNull();
  expect(f.note.mock.calls.map(call => call[0]).filter(note => note.startsWith('Completed:'))).toEqual([
    'Completed: Inspecting merged release source (0m 0s).',
    'Completed: Preparing isolated release source (0m 0s).',
    'Completed: Archiving and signing the ios app (0m 0s).',
    'Completed: Validating archive identity and signatures (0m 0s).',
    'Completed: Uploading the signed app to App Store Connect (0m 0s).',
    'Completed: Cleaning up isolated release source (0m 0s).',
  ]);
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

test('a macOS release archives only macOS without running either platform test suite', async t => {
  const f = await fixture(t, undefined, 'macos');
  await releaseAppFromTerminal(f.options);
  const commands = f.command.mock.calls;
  expect(commands.some(call => ['just', 'mise', 'pnpm'].includes(call[0]))).toBe(false);
  expect(commands.some(call => call[0] === 'xcodebuild' && call[1].includes('test'))).toBe(false);
  expect(commands.some(call => call[0] === 'xcodebuild' && call[1].includes('generic/platform=macOS'))).toBe(true);
  expect(commands.some(call => call[0] === 'xcodebuild' && call[1].includes('generic/platform=iOS'))).toBe(false);
  expect(await lastAppUpload(f.directory, 'macos')).toMatchObject({ sha, state: 'uploaded' });
});

test('stale review fails before archiving or signing', async t => {
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

test('a failed archive reports its milestone and prevents upload', async t => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  t.onTestFinished(() => clock.mockRestore());
  const f = await fixture(t, 'archive');
  await expect(releaseAppFromTerminal(f.options)).rejects.toThrow('Archive failed');
  expect(f.command.mock.calls.some(call => call[1].includes('-exportArchive'))).toBe(false);
  expect(f.note.mock.calls.map(call => call[0])).toContain('Stopped: Archiving and signing the ios app (0m 0s).');
});

test('upload failure does not retry or record a successful upload', async t => {
  const f = await fixture(t, 'upload');
  await expect(releaseAppFromTerminal(f.options)).rejects.toThrow('Upload connection lost');
  expect(f.command.mock.calls.filter(call => call[1][0] === '-exportArchive')).toHaveLength(1);
  expect(await lastAppUpload(f.directory, 'ios')).toBeNull();
  await expect(fs.access(path.join(f.directory, 'app-release.lock'))).rejects.toThrow('ENOENT');
});

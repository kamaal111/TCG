import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { appFingerprint, readAppSettings, saveAppSettings } from './config.ts';

const settings = { version: 1, teamID: 'DXUKH9VF73', apiHost: 'api.mintomo.com' } as const;

test('saves validated settings privately and fingerprints the platform and selected commit', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-settings-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  await saveAppSettings(directory, settings);
  expect(await readAppSettings(directory)).toEqual(settings);
  expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
  expect((await fs.stat(path.join(directory, 'app-release.json'))).mode & 0o777).toBe(0o600);
  expect(appFingerprint('ios', 'a'.repeat(40), settings)).not.toBe(appFingerprint('macos', 'a'.repeat(40), settings));
});

test.each([
  'localhost',
  'api.example.com',
  'API.EXAMPLE.COM',
  'https://api.mintomo.com',
  'api.mintomo.com/path',
  'api.mintomo.com:443',
  'host\nINJECT=YES',
])('rejects invalid production hostname %s without replacing saved settings', async apiHost => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-settings-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  await saveAppSettings(directory, settings);
  await expect(saveAppSettings(directory, { ...settings, apiHost })).rejects.toThrow(/Invalid/);
  expect(await readAppSettings(directory)).toEqual(settings);
});

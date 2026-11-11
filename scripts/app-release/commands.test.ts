import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { appCommands } from './commands.ts';

test('captures command output and retains diagnostics on failure', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-commands-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const log = path.join(root, 'release.log');
  const command = appCommands({ root, log });
  expect(await command(process.execPath, ['-e', 'console.log("archive details")'])).toBe('archive details');
  await expect(
    command(process.execPath, ['-e', 'console.error("signing unavailable"); process.exit(1)']),
  ).rejects.toThrow('Check the private log');
  expect(await fs.readFile(log, 'utf8')).toContain('signing unavailable');
});

test('cancellation terminates a running command and does not start another', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-commands-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const log = path.join(root, 'release.log');
  const signal = new AbortController();
  const command = appCommands({ root, log, signal: signal.signal });
  const running = command(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)']);
  await Promise.all([
    expect(running).rejects.toThrow('Check the private log'),
    (async () => {
      await vi.waitFor(async () => expect(await fs.readFile(log, 'utf8')).toContain('\nready\n'));
      signal.abort();
    })(),
  ]);
  await expect(command(process.execPath, ['-e', 'console.log("unexpected")'])).rejects.toThrow('cancelled');
  expect(await fs.readFile(log, 'utf8')).not.toContain('unexpected');
});

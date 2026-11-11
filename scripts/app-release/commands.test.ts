import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { appCommands } from './commands.ts';

test('captures command output and retains diagnostics on failure', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-commands-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const log = path.join(root, 'release.log');
  const output = vi.fn<(chunk: string) => void>();
  const command = appCommands({ root, log, output });
  expect(await command(process.execPath, ['-e', 'console.log("archive details")'])).toBe('archive details');
  await expect(
    command(process.execPath, ['-e', 'console.error("signing unavailable"); process.exit(1)']),
  ).rejects.toThrow('signing unavailable');
  expect(await fs.readFile(log, 'utf8')).toContain('signing unavailable');
  expect(output.mock.calls.flat().join('')).toContain('archive details');
  expect(output.mock.calls.flat().join('')).toContain('signing unavailable');
});

test('cancellation terminates a running command and does not start another', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-commands-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const log = path.join(root, 'release.log');
  const signal = new AbortController();
  const output = vi.fn<(chunk: string) => void>();
  const command = appCommands({ root, log, signal: signal.signal, output });
  const running = command(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)']);
  await Promise.all([
    expect(running).rejects.toThrow('cancelled'),
    (async () => {
      await vi.waitFor(async () => expect(await fs.readFile(log, 'utf8')).toContain('\nready\n'));
      expect(output.mock.calls.flat().join('')).toContain('\nready\n');
      signal.abort();
    })(),
  ]);
  await expect(command(process.execPath, ['-e', 'console.log("unexpected")'])).rejects.toThrow('cancelled');
  expect(await fs.readFile(log, 'utf8')).not.toContain('unexpected');
});

test('forwards stdout-only failures and preserves the failing exit status', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-commands-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const command = appCommands({ root, log: path.join(root, 'release.log') });
  const failure = command(process.execPath, ['-e', 'console.log("verification failed: missing SDK"); process.exit(7)']);
  await expect(failure).rejects.toMatchObject({
    exitCode: 7,
    message: expect.stringContaining('verification failed: missing SDK'),
  });
  await expect(failure).rejects.toThrow('exit 7');
  await expect(failure).rejects.not.toThrow('Xcode Accounts');
  await expect(failure).rejects.not.toThrow('App Store Connect');
});

test('keeps upload uncertainty guidance specific to upload failures', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-commands-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'xcodebuild'), '#!/bin/sh\necho "Upload connection lost" >&2\nexit 9\n', {
    mode: 0o755,
  });

  const command = appCommands({
    root,
    log: path.join(root, 'release.log'),
    environment: { ...process.env, PATH: `${root}:${process.env.PATH}` },
  });

  await expect(command('xcodebuild', ['-exportArchive'])).rejects.toThrow('Check App Store Connect before retrying');
});

test('bounds displayed diagnostics, strips terminal escapes and retains the full raw log', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-commands-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const log = path.join(root, 'release.log');
  const command = appCommands({ root, log });

  const failure = command(process.execPath, [
    '-e',
    'process.stdout.write("x".repeat(300000), () => { console.error("\\x1b[31merror: missing signing certificate\\x1b[0m"); process.exitCode = 3; });',
  ]);

  await expect(failure).rejects.toThrow('Earlier output omitted');
  await expect(failure).rejects.toThrow('error: missing signing certificate');
  await expect(failure).rejects.not.toThrow('\u001b');
  expect((await fs.readFile(log, 'utf8')).length).toBeGreaterThan(300000);
});

test('stops an unresponsive command after the idle deadline and retains its diagnostics', async t => {
  vi.useFakeTimers();
  t.onTestFinished(() => {
    vi.useRealTimers();
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-idle-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const output = vi.fn<(chunk: string) => void>();

  const command = appCommands({
    root,
    log: path.join(root, 'release.log'),
    idleTimeoutMs: 60_000,
    output,
  });

  const running = command(process.execPath, ['-e', 'console.log("build waiting"); setInterval(() => {}, 1000)']);
  await vi.waitFor(() => expect(output).toHaveBeenCalledWith('build waiting\n'));

  await Promise.all([
    expect(running).rejects.toMatchObject({
      exitCode: 124,
      message: expect.stringContaining('No tool output for 60 seconds'),
    }),
    (async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    })(),
  ]);
  expect(await fs.readFile(path.join(root, 'release.log'), 'utf8')).toContain('build waiting');
  expect(vi.getTimerCount()).toBe(0);
});

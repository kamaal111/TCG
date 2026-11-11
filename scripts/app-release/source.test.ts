import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';

import { inspectAppSource } from './runtime.ts';
import type { Command } from './xcode.ts';

const execute = util.promisify(childProcess.execFile);

test('reads the version from pinned merged source and rejects an unmerged local commit', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-source-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const command: Command = async (program, args, cwd = root) => (await execute(program, args, { cwd })).stdout.trim();
  await command('git', ['init', '-b', 'main']);
  await command('git', ['config', 'user.name', 'Release Test']);
  await command('git', ['config', 'user.email', 'release@example.com']);
  await fs.mkdir(path.join(root, 'app/Configuration'), { recursive: true });
  await fs.writeFile(path.join(root, 'app/Configuration/App.xcconfig'), 'MARKETING_VERSION = 1.0\n');
  await command('git', ['add', '.']);
  await command('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Initial app']);
  const merged = await command('git', ['rev-parse', 'HEAD']);
  await command('git', ['remote', 'add', 'origin', root]);
  expect(await inspectAppSource(root, 'origin/main', command)).toEqual({ sha: merged, version: '1.0' });
  await command('git', ['checkout', '-b', 'feature']);
  await fs.writeFile(path.join(root, 'app/Configuration/App.xcconfig'), 'MARKETING_VERSION = 2.0\n');
  await command('git', ['add', '.']);
  await command('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Unmerged app']);
  expect(await inspectAppSource(root, merged, command)).toEqual({ sha: merged, version: '1.0' });
  await expect(inspectAppSource(root, 'HEAD', command)).rejects.toThrow('already merged');
});

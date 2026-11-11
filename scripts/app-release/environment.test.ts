import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';

import { appReleaseEnvironment } from './environment.ts';

const execute = util.promisify(childProcess.execFile);

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'release tools-')));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const shims = path.join(root, 'shims');
  const tools = path.join(root, 'tools');
  const outside = path.join(root, 'outside project');
  await fs.mkdir(shims);
  await fs.mkdir(tools);
  await fs.mkdir(outside);
  const mise = path.join(root, 'mise');
  const just = path.join(tools, 'just');
  await fs.writeFile(
    mise,
    `#!${process.execPath}\nif (process.env.TCG_TEST_JUST) { console.log(process.env.TCG_TEST_JUST); } else { console.error('No version is set for shim: just'); process.exit(1); }\n`,
    { mode: 0o755 },
  );
  await fs.writeFile(just, `#!${process.execPath}\nconsole.log('just fixture');\n`, { mode: 0o755 });
  await fs.symlink(mise, path.join(shims, 'just'));

  return { root, shims, tools, outside, just };
}

test('bypasses an inactive mise shim and keeps just runnable in nested test directories', async () => {
  const f = await fixture();
  const input = { PATH: `${f.shims}:${f.tools}:/usr/bin:/bin` };
  const originalPath = input.PATH;
  const environment = await appReleaseEnvironment({ root: f.root, environment: input });
  const result = await execute('just', ['--version'], { cwd: f.outside, env: environment });
  expect(result.stdout.trim()).toBe('just fixture');
  expect(environment.PATH).toBe(`${f.tools}:${originalPath}`);
  expect(input.PATH).toBe(originalPath);
});

test('keeps a configured mise just version instead of selecting another installation', async () => {
  const f = await fixture();

  const environment = await appReleaseEnvironment({
    root: f.root,
    environment: { PATH: f.shims, TCG_TEST_JUST: f.just },
  });

  expect(environment.PATH).toBe(`${f.tools}:${f.shims}`);
  const result = await execute('just', ['--version'], { cwd: f.outside, env: environment });
  expect(result.stdout.trim()).toBe('just fixture');
});

test('explains a missing just installation before starting any checks', async () => {
  const f = await fixture();
  await expect(appReleaseEnvironment({ root: f.root, environment: { PATH: f.outside } })).rejects.toThrow(
    'just was not found on PATH',
  );
});

test('forwards the mise lookup error when no real just executable is available', async () => {
  const f = await fixture();
  await expect(appReleaseEnvironment({ root: f.root, environment: { PATH: f.shims } })).rejects.toThrow(
    'No version is set for shim: just',
  );
});

import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function logFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app logs-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  const ios = path.join(directory, 'app-releases/ios-older/release.log');
  const macos = path.join(directory, 'app-releases/macos-newer/release.log');
  await fs.mkdir(path.dirname(ios), { recursive: true });
  await fs.mkdir(path.dirname(macos), { recursive: true });
  await fs.writeFile(ios, 'ios log\n');
  await fs.writeFile(macos, 'macos log\n');
  await fs.utimes(ios, 100, 100);
  await fs.utimes(macos, 200, 200);

  return { directory, ios, macos };
}

test.each(['setup-app-release', 'release-ios', 'release-macos', 'logs-app-release'])(
  '%s forwards help without needing Apple credentials or a terminal',
  recipe => {
    const result = childProcess.spawnSync('just', [recipe, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('$HOME/.config/tcg');
    expect(result.stdout).toContain('origin/main');
  },
);

test('an unattended app release stops before building', () => {
  const result = childProcess.spawnSync(process.execPath, ['scripts/app-release-cli.ts', 'ios'], { encoding: 'utf8' });
  expect(result.status).toBe(64);
  expect(result.stderr).toContain('interactive terminal');
});

test.each([
  { platform: [], expected: 'macos-newer' },
  { platform: ['ios'], expected: 'ios-older' },
  { platform: ['macos'], expected: 'macos-newer' },
])('log watching selects $expected and uses tail with the full path as one argument', async selection => {
  const f = await logFixture();
  const tools = path.join(f.directory, 'tools');
  await fs.mkdir(tools);
  await fs.writeFile(path.join(tools, 'tail'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });

  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/app-release-cli.ts', 'logs', ...selection.platform],
    {
      env: { ...process.env, TCG_CONFIG_DIRECTORY: f.directory, PATH: tools },
      encoding: 'utf8',
    },
  );

  expect(result.status).toBe(0);
  expect(result.stdout.trim().split('\n')).toEqual([
    '-n',
    '100',
    '-F',
    path.join(f.directory, 'app-releases', selection.expected, 'release.log'),
  ]);
  expect(result.stderr).toContain('Ctrl-C');
});

test('log watching streams appended output and stops without changing the log', async t => {
  const f = await logFixture();

  const child = childProcess.spawn(
    process.execPath,
    ['scripts/app-release-cli.ts', 'logs', 'ios', '--config-dir', f.directory],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  t.onTestFinished(() => {
    child.kill('SIGTERM');
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));
  await vi.waitFor(() => expect(output).toContain('ios log'));
  await fs.appendFile(f.ios, 'archive completed\n');
  await vi.waitFor(() => expect(output).toContain('archive completed'), { timeout: 3000 });
  child.kill('SIGTERM');
  expect(await closed).toBe(0);
  expect(await fs.readFile(f.ios, 'utf8')).toBe('ios log\narchive completed\n');
});

test('log watching explains missing sessions without asking for Apple setup', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'no app logs-'));
  t.onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));

  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/app-release-cli.ts', 'logs', '--config-dir', directory],
    { encoding: 'utf8' },
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('No app release log found');
  expect(result.stderr).not.toContain('interactive terminal');
});

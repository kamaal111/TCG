import childProcess from 'node:child_process';
import url from 'node:url';

const cli = url.fileURLToPath(new URL('./release-cli.ts', import.meta.url));

function run(args: string[]) {
  return childProcess.spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('help explains the default settings directory and automation without requiring a terminal', () => {
  const result = run(['--help']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('$HOME/.config/tcg');
  expect(result.stdout).toContain('--non-interactive');
});

test('unattended guided releases stop with instructions instead of performing a deployment', () => {
  const result = run([]);
  expect(result.status).toBe(64);
  expect(result.stderr).toContain('interactive terminal');
});

test('an empty settings directory fails clearly', () => {
  const result = run(['--config-dir', '']);
  expect(result.status).toBe(64);
  expect(result.stderr).toContain('settings directory must not be empty');
});

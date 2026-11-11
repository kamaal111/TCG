import childProcess from 'node:child_process';

test.each(['setup-app-release', 'release-ios', 'release-macos'])(
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

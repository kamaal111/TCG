import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const script = url.fileURLToPath(new URL('./agent-service-cli.ts', import.meta.url));

test('installs and removes only the private user LaunchAgent, preserving configuration', async t => {
  if (process.platform !== 'darwin') {
    t.skip();

    return;
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mintomo launch agent-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  const config = path.join(directory, 'config');
  const bin = path.join(directory, 'bin');
  await fs.mkdir(config);
  await fs.mkdir(bin);
  const calls = path.join(directory, 'calls.jsonl');
  await fs.writeFile(path.join(config, 'devportal.json'), JSON.stringify({ allowedLogins: ['operator@example.com'] }));

  for (const tool of ['git', 'docker', 'mise', 'just', 'launchctl']) {
    await fs.writeFile(
      path.join(bin, tool),
      `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.CALLS,JSON.stringify(process.argv.slice(2))+'\\n');\n`,
      { mode: 0o755 },
    );
  }

  const run = (action: string) => {
    return childProcess.spawnSync(process.execPath, [script, action], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: directory,
        TCG_CONFIG_DIRECTORY: config,
        PATH: `${bin}:${process.env.PATH}`,
        CALLS: calls,
      },
    });
  };

  const installed = run('install');
  expect(installed.status).toBe(0);
  const plist = path.join(directory, 'Library/LaunchAgents/io.kamaal.mintomo-devportal.plist');
  const content = await fs.readFile(plist, 'utf8');
  expect(content).toContain('devportal/src/index.ts');
  expect(
    childProcess
      .execFileSync('plutil', ['-extract', 'RunAtLoad', 'raw', '-o', '-', plist], { encoding: 'utf8' })
      .trim(),
  ).toBe('true');
  expect((await fs.stat(plist)).mode & 0o777).toBe(0o600);
  expect(childProcess.spawnSync('plutil', ['-lint', plist]).status).toBe(0);
  expect(await fs.readFile(calls, 'utf8')).not.toContain('release-server');

  const inferred = childProcess.spawnSync(
    process.execPath,
    [url.fileURLToPath(new URL('./agent.ts', import.meta.url)), 'preview'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: directory,
        TCG_CONFIG_DIRECTORY: undefined,
        PATH: `${bin}:${process.env.PATH}`,
        CALLS: calls,
      },
    },
  );

  expect(inferred.status).toBe(0);
  expect(inferred.stdout).toContain(config);

  const preview = (requestedDirectory: string) => {
    return childProcess.spawnSync(
      process.execPath,
      [url.fileURLToPath(new URL('./agent.ts', import.meta.url)), 'preview', '--config-dir', requestedDirectory],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: directory,
          TCG_CONFIG_DIRECTORY: undefined,
          PATH: `${bin}:${process.env.PATH}`,
          CALLS: calls,
        },
      },
    );
  };

  expect(preview(config).status).toBe(0);
  const mismatched = preview(path.join(directory, 'another config'));
  expect(mismatched.status).toBe(1);
  expect(mismatched.stderr).toContain('differs from the installed agent');
  expect(run('uninstall').status).toBe(0);
  await expect(fs.access(plist)).rejects.toThrow('ENOENT');
  await expect(fs.access(path.join(config, 'devportal.json'))).resolves.toBeUndefined();
});

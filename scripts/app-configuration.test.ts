import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg app configuration-'));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'configuration-valid');

  return {
    output,
    run: (environment: string, host: string) => {
      return childProcess.spawnSync('bash', ['scripts/check-app-configuration.sh'], {
        encoding: 'utf8',
        env: { ...process.env, TCG_API_ENVIRONMENT: environment, TCG_API_HOST: host, SCRIPT_OUTPUT_FILE_0: output },
      });
    },
  };
}

it('fails remote builds without a hostname and explains how to configure it', async () => {
  const f = await fixture();
  const result = f.run('remote', '');

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Remote.local.xcconfig');
  expect(result.stderr).toContain('TCG_API_HOST');
  await expect(fs.stat(f.output)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('accepts a remote hostname without displaying its private value', async () => {
  const f = await fixture();
  const result = f.run('remote', 'private-fixture.example.com');

  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('');
  expect(await fs.readFile(f.output, 'utf8')).toBe('validated\n');
});

it('allows local builds without a private hostname', async () => {
  const f = await fixture();
  const result = f.run('local', '');

  expect(result.status).toBe(0);
  expect(await fs.readFile(f.output, 'utf8')).toBe('validated\n');
});

it('rejects an unknown environment instead of selecting a fallback', async () => {
  const f = await fixture();
  const result = f.run('production', 'private-fixture.example.com');

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Select the TCG or TCG Local');
  await expect(fs.stat(f.output)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('keeps the private hostname file ignored even before it exists', () => {
  const result = childProcess.spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    input: 'app/Configuration/Remote.local.xcconfig\n',
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toBe('app/Configuration/Remote.local.xcconfig\n');
});

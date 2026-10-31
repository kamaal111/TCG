import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { TestContext } from 'vitest';

const reference = path.resolve('app/Modules/TCGClient/Sources/TCGClient/openapi.yaml');

function run(command: 'check' | 'download', outputFile: string) {
  return childProcess.spawnSync(process.execPath, [`server/scripts/${command}-openapi-spec.ts`, outputFile], {
    env: {},
    encoding: 'utf8',
    timeout: 10_000,
  });
}

async function fixture(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg spec '));
  t.onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));

  return path.join(directory, 'openapi.yaml');
}

test('checks the committed OpenAPI spec without environment configuration', () => {
  const result = run('check', reference);

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('OpenAPI spec is up to date.');
});

test('generates the same OpenAPI spec without environment configuration', async t => {
  const output = await fixture(t);
  const result = run('download', output);

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(await fs.readFile(output, 'utf8')).toBe(await fs.readFile(reference, 'utf8'));
});

test('rejects an outdated OpenAPI spec without environment configuration', async t => {
  const output = await fixture(t);
  await fs.writeFile(output, 'openapi: stale\n');
  const result = run('check', output);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('OpenAPI spec is out of date.');
  expect(await fs.readFile(output, 'utf8')).toBe('openapi: stale\n');
});

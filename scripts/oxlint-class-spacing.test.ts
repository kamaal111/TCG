import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { z } from 'zod';

const ROOT = url.fileURLToPath(new URL('../', import.meta.url));

const CONFIG = path.join(ROOT, 'oxlint.config.ts');

const RULE_CODE = '@stylistic(lines-between-class-members)';

const COMPACT_CLASS = `export class Example {
  private readonly value: string;
  readonly label = 'example';
  constructor(value: string) {
    this.value = value;
  }
  read(): string {
    return this.value;
  }
}
`;

const SPACED_CLASS = `export class Example {
  private readonly value: string;
  readonly label = 'example';

  constructor(value: string) {
    this.value = value;
  }

  read(): string {
    return this.value;
  }
}
`;

const LintOutputSchema = z.object({
  diagnostics: z.array(z.object({ code: z.string(), message: z.string() })),
});

async function createFixture(source: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-class-spacing-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'fixture.ts');
  await fs.writeFile(filename, source);

  return filename;
}

function lint(filename: string, fix = false) {
  const args = ['exec', 'oxlint', '-c', CONFIG, '--format', 'json', filename];

  if (fix) {
    args.push('--fix');
  }

  const result = childProcess.spawnSync('pnpm', args, { cwd: ROOT, encoding: 'utf8' });

  return { status: result.status, ...LintOutputSchema.parse(JSON.parse(result.stdout)) };
}

test('Oxlint rejects a constructor touching fields and a method touching its constructor', async () => {
  const filename = await createFixture(COMPACT_CLASS);
  const result = lint(filename);
  expect(result.status).toBe(1);
  expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([RULE_CODE, RULE_CODE]);
});

test('Oxlint accepts spaced methods while allowing consecutive fields to stay grouped', async () => {
  const filename = await createFixture(SPACED_CLASS);
  const result = lint(filename);
  expect(result.status).toBe(0);
  expect(result.diagnostics).toEqual([]);
});

test('Oxlint fixes missing class-member spacing automatically', async () => {
  const filename = await createFixture(COMPACT_CLASS);
  const result = lint(filename, true);
  expect(result.status).toBe(0);
  expect(result.diagnostics).toEqual([]);
  expect(await fs.readFile(filename, 'utf8')).toBe(SPACED_CLASS);
});

import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { z } from 'zod';

const ROOT = url.fileURLToPath(new URL('../', import.meta.url));

const CONFIG = path.join(ROOT, 'oxlint.config.ts');

const LintOutputSchema = z.object({
  diagnostics: z.array(z.object({ code: z.string(), message: z.string() })),
});

export async function createLintFixture(source: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-oxlint-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'fixture.ts');
  await fs.writeFile(filename, source);

  return filename;
}

export function lintFixture(filename: string, fix = false) {
  const args = ['exec', 'oxlint', '-c', CONFIG, '--format', 'json', filename];

  if (fix) {
    args.push('--fix');
  }

  const result = childProcess.spawnSync('pnpm', args, { cwd: ROOT, encoding: 'utf8' });

  return { status: result.status, ...LintOutputSchema.parse(JSON.parse(result.stdout)) };
}

import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const SOURCE_ROOT = url.fileURLToPath(new URL('../../', import.meta.url));

const IMPORT_PATTERN =
  /(?:import|export)\s+(?:type\s+)?[^;]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

async function boundaryViolations(): Promise<string[]> {
  const files = await fs.readdir(SOURCE_ROOT, { recursive: true });
  const violations: string[] = [];

  for (const file of files.filter(
    file => file.endsWith('.ts') && !file.includes('tests/') && !file.endsWith('.test.ts'),
  )) {
    const source = await fs.readFile(path.join(SOURCE_ROOT, file), 'utf8');

    const provider =
      file.startsWith('persistence/postgres/') || file.startsWith('db/') || file === 'storage/s3-client.ts';

    const runtime = file.startsWith('runtime/node/');

    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const dependency = match[1] ?? match[2] ?? '';

      const target = dependency.startsWith('.')
        ? path.relative(SOURCE_ROOT, path.resolve(SOURCE_ROOT, path.dirname(file), dependency))
        : dependency;

      const databaseDependency =
        /^(drizzle-orm|pg)(\/|$)/.test(target) ||
        target.startsWith('db/') ||
        target.startsWith('persistence/postgres/');

      if (!provider && !runtime && databaseDependency) {
        violations.push(`${file} imports provider ${dependency}`);
      }

      if (file.startsWith('persistence/postgres/') && (/^hono(\/|$)/.test(target) || target === 'context.ts')) {
        violations.push(`${file} imports HTTP boundary ${dependency}`);
      }

      if (!runtime && target === '@hono/node-server') {
        violations.push(`${file} imports Node serving`);
      }

      if (!runtime && file !== 'env.ts' && target === 'env.ts') {
        violations.push(`${file} imports process configuration`);
      }
    }

    if (!runtime && file !== 'env.ts' && /process\.(on|exit|env)\b/.test(source)) {
      violations.push(`${file} uses process lifecycle or environment`);
    }
  }

  return violations;
}

test('application and domain modules cannot import persistence providers or Node lifecycle', async () => {
  expect(await boundaryViolations()).toEqual([]);
});

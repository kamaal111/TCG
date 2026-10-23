import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const SOURCE_ROOT = url.fileURLToPath(new URL('../../', import.meta.url));

function unmanagedErrors(source: string): string[] {
  return Array.from(
    source.matchAll(
      /\b(?:new|extends)\s+(?:(?:globalThis|global)\s*\.\s*)?(?:Error|TypeError|RangeError|SyntaxError|ReferenceError|URIError|EvalError|AggregateError|HTTPException)\b/g,
    ),
    match => match[0],
  );
}

test('rejects generic error construction and inheritance, including qualified names', () => {
  expect(unmanagedErrors('class Failure extends Error {}')).toEqual(['extends Error']);
  expect(unmanagedErrors('throw new Error("private details")')).toEqual(['new Error']);
  expect(unmanagedErrors('throw new globalThis.TypeError("private details")')).toEqual(['new globalThis.TypeError']);
  expect(unmanagedErrors('class Failure extends InternalServerError {}')).toEqual([]);
  expect(unmanagedErrors('throw new InternalServerError()')).toEqual([]);
});

test('production code uses the shared exception hierarchy instead of generic errors', async () => {
  const files = await fs.readdir(SOURCE_ROOT, { recursive: true });
  const failures: string[] = [];

  for (const file of files.filter(
    file => file.endsWith('.ts') && !file.includes('tests/') && !file.endsWith('.test.ts'),
  )) {
    const source = await fs.readFile(path.join(SOURCE_ROOT, file), 'utf8');
    const violations = unmanagedErrors(source);

    // APIException is the sole bridge to Hono's exception base.
    const unexpected =
      file === 'exceptions/index.ts'
        ? violations.filter(violation => violation !== 'extends HTTPException')
        : violations;

    failures.push(...unexpected.map(violation => `${file}: ${violation}`));
  }

  expect(failures).toEqual([]);
});

import { createLintFixture, lintFixture } from './oxlint-test-utils.ts';

test.each(['scripts', 'server/src'])('Oxlint preserves shared Node import restrictions in %s', async directory => {
  const filename = await createLintFixture(
    "import { readFile } from 'node:fs/promises';\n\nexport { readFile };",
    directory,
  );

  const result = lintFixture(filename);
  expect(result.status).toBe(1);
  expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('eslint(no-restricted-imports)');
});

test.each(['scripts', 'server/src'])('Oxlint accepts default Node imports in %s', async directory => {
  const filename = await createLintFixture(
    "import fs from 'node:fs/promises';\n\nexport const read = fs.readFile;",
    directory,
  );

  const result = lintFixture(filename);
  expect(result.status).toBe(0);
  expect(result.diagnostics).toEqual([]);
});

test.each(['scripts', 'server/src'])('Oxlint preserves Vitest global import restrictions in %s', async directory => {
  const filename = await createLintFixture("import { expect } from 'vitest';\n\nexport { expect };", directory);

  const result = lintFixture(filename);
  expect(result.status).toBe(1);
  expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('eslint(no-restricted-imports)');
});

test('Oxlint preserves the production restriction on test-only imports', async () => {
  const filename = await createLintFixture(
    "import { fixture } from '../tests/fixture.ts';\n\nexport { fixture };",
    'server/src',
  );

  const result = lintFixture(filename);
  expect(result.status).toBe(1);
  expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('eslint(no-restricted-imports)');
});

test('Oxlint inherits the shared Object.assign restriction', async () => {
  const filename = await createLintFixture('export const result = Object.assign({}, { value: 1 });');

  const result = lintFixture(filename);
  expect(result.status).toBe(1);
  expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('eslint(no-restricted-properties)');
});

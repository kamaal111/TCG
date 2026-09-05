import { lintWithRule } from './test-utils/lint-with-rule.ts';

const PLUGIN = 'consistent-inline-type-imports.ts';
const RULE_ID = 'local/no-all-inline-type-imports';

function lint(source: string) {
  return lintWithRule({ plugin: PLUGIN, ruleId: RULE_ID, source });
}

describe('no-all-inline-type-imports', () => {
  test('flags `import { type A, type B } from "x"` and fixes it to a top-level `import type`', async () => {
    const result = await lint("import { type A, type B } from 'x';\n");

    expect(result.isReported).toBe(true);
    expect(result.fixedSource).toBe("import type { A, B } from 'x';\n");
  });

  test('flags a single inline-typed named import and preserves its local alias when fixing', async () => {
    const result = await lint("import { type A as B } from 'x';\n");

    expect(result.isReported).toBe(true);
    expect(result.fixedSource).toBe("import type { A as B } from 'x';\n");
  });

  test('does not flag a mix of value and inline-typed named imports', async () => {
    const result = await lint("import { ok, type Result } from 'neverthrow';\n");

    expect(result.isReported).toBe(false);
  });

  test('does not flag an import that already uses a top-level `import type`', async () => {
    const result = await lint("import type { A, B } from 'x';\n");

    expect(result.isReported).toBe(false);
  });

  test('does not flag an inline-typed named import combined with a default import', async () => {
    const result = await lint("import Default, { type A } from 'x';\n");

    expect(result.isReported).toBe(false);
  });
});

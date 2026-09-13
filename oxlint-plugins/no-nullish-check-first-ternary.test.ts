import { lintWithRule } from './test-utils/lint-with-rule.ts';

const PLUGIN = 'no-nullish-check-first-ternary.ts';

const RULE_ID = 'local-ternary/no-nullish-check-first-ternary';

function lint(source: string) {
  return lintWithRule({ plugin: PLUGIN, ruleId: RULE_ID, source });
}

describe('no-nullish-check-first-ternary', () => {
  test('flags `x == null ? undefined : value` and fixes it to `x != null ? value : undefined`', async () => {
    const result = await lint('export const trimmed = value == null ? undefined : value.trim();\n');

    expect(result.isReported).toBe(true);
    expect(result.fixedSource).toBe('export const trimmed = value != null ? value.trim() : undefined;\n');
  });

  test('flags `x === undefined ? undefined : value` and fixes it to `x !== undefined ? value : undefined`', async () => {
    const result = await lint('export const trimmed = value === undefined ? undefined : value.trim();\n');

    expect(result.isReported).toBe(true);
    expect(result.fixedSource).toBe('export const trimmed = value !== undefined ? value.trim() : undefined;\n');
  });

  test('flags `x == null ? null : value` and fixes it to `x != null ? value : null`', async () => {
    const result = await lint('export const trimmed = value == null ? null : value.trim();\n');

    expect(result.isReported).toBe(true);
    expect(result.fixedSource).toBe('export const trimmed = value != null ? value.trim() : null;\n');
  });

  test('flags `a == null || b == null ? undefined : value` and fixes it to `a != null && b != null ? value : undefined`', async () => {
    const result = await lint('export const pair = a == null || b == null ? undefined : { a, b };\n');

    expect(result.isReported).toBe(true);
    expect(result.fixedSource).toBe('export const pair = a != null && b != null ? { a, b } : undefined;\n');
  });

  test('does not flag `a != null && b != null ? value : undefined`, which already puts the value branch first', async () => {
    const result = await lint('export const pair = a != null && b != null ? { a, b } : undefined;\n');

    expect(result.isReported).toBe(false);
  });

  test('does not flag `a == null || b > 0 ? undefined : value`, whose OR chain mixes in a non-nullish check', async () => {
    const result = await lint('export const label = a == null || b > 0 ? undefined : value;\n');

    expect(result.isReported).toBe(false);
  });

  test('does not flag `x != null ? value : undefined`, which already puts the value branch first', async () => {
    const result = await lint('export const trimmed = value != null ? value.trim() : undefined;\n');

    expect(result.isReported).toBe(false);
  });

  test('does not flag ternaries whose test is unrelated to a nullish check', async () => {
    const result = await lint('export const label = count > 0 ? "some" : "none";\n');

    expect(result.isReported).toBe(false);
  });

  test('does not flag a nullish-first test when the consequent branch is not itself nullish', async () => {
    const result = await lint('export const label = value == null ? "fallback" : value;\n');

    expect(result.isReported).toBe(false);
  });
});

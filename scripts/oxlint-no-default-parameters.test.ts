import { createLintFixture, lintFixture } from './oxlint-test-utils.ts';

const RULE = 'tcg(no-default-parameters)';

test.each([
  'export function repeat(count = 2) { return count; }',
  'export const repeat = (count = 2) => count;',
  'export const actions = { repeat(count = 2) { return count; } };',
  'export class Repeater { constructor(readonly count = 2) {} }',
  'export function repeat({ counts: [count = 2] }: { counts: number[] }) { return count; }',
])('Oxlint rejects default parameters in %s', async source => {
  const filename = await createLintFixture(source);
  const result = lintFixture(filename, false);
  expect(result.status).toBe(1);
  expect(result.diagnostics.filter(diagnostic => diagnostic.code === RULE)).toHaveLength(1);
});

test.each([
  'export function repeat(count: number | undefined) { return count; }',
  'export function repeat(count?: number) { return count; }',
  'export function repeat(values: number[]) {\n  const [count = 2] = values;\n\n  return count;\n}',
])('Oxlint accepts explicit parameters in %s', async source => {
  const filename = await createLintFixture(source);
  const result = lintFixture(filename, false);
  expect(result.status).toBe(0);
  expect(result.diagnostics).toEqual([]);
});

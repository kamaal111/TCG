import { createLintFixture, lintFixture } from './oxlint-test-utils.ts';

const MESSAGE = 'Use .nullish() instead of chaining .nullable() and .optional().';

test.each([
  'z.string().nullable().optional()',
  'z.string().optional().nullable()',
  'schema\n  .nullable()\n  .optional()',
  'schema.nullable({ error: "Invalid value" }).optional()',
])('Oxlint rejects %s and recommends .nullish()', async expression => {
  const filename = await createLintFixture(`export const schema = ${expression};`);
  const result = lintFixture(filename);
  expect(result.status).toBe(1);
  expect(result.diagnostics).toEqual([{ code: 'tcg-zod(prefer-nullish)', message: MESSAGE }]);
});

test.each([
  'z.string().nullish()',
  'z.string().nullable()',
  'z.string().optional()',
  'z.object({ first: z.string().nullable(), second: z.string().optional() })',
  '"schema.nullable().optional()"',
])('Oxlint accepts %s', async expression => {
  const filename = await createLintFixture(`export const schema = ${expression};`);
  const result = lintFixture(filename);
  expect(result.status).toBe(0);
  expect(result.diagnostics).toEqual([]);
});

import { migrationStatus, PlanSchema, summarizePlan } from './contracts.ts';

test('a legacy successful readiness check remains usable without claiming JSON support', () => {
  expect(migrationStatus('Required database migrations are applied.\n')).toEqual({ status: 'ready', pending: 0 });
});

test('a structured readiness response identifies pending migrations', () => {
  expect(migrationStatus('{"protocol":1,"status":"pending","pending":2}')).toEqual({
    protocol: 1,
    status: 'pending',
    pending: 2,
  });
});

test.each([
  'Database unavailable',
  '{"protocol":1,"status":"ready","pending":1}',
  '{"protocol":1,"status":"pending","pending":0}',
])('an ambiguous or inconsistent migration response stops the release: %s', output => {
  expect(() => migrationStatus(output)).toThrow('Cannot determine migration readiness');
});

test('a plan with only output changes still requires apply approval', () => {
  const plan = PlanSchema.parse({
    output_changes: { inventory: { actions: ['update'], after: { secret: 'not displayed' } } },
  });

  expect(summarizePlan(plan)).toEqual({ changed: true, summary: 'Output: inventory' });
});

test('an import with no resource modification still requires apply approval', () => {
  const plan = PlanSchema.parse({
    resource_changes: [{ address: 'module.tcg.server', change: { actions: ['no-op'], importing: { id: '123' } } }],
  });

  expect(summarizePlan(plan).changed).toBe(true);
});

test('an unchanged plan does not require apply approval', () => {
  expect(
    summarizePlan(PlanSchema.parse({ resource_changes: [{ address: 'server', change: { actions: ['no-op'] } }] })),
  ).toEqual({ changed: false, summary: 'No changes.' });
});

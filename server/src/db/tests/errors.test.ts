import { classifyPostgresError } from '../errors.ts';

describe('classifyPostgresError', () => {
  it('classifies a lock_not_available error by its code', () => {
    expect(classifyPostgresError({ code: '55P03' })).toBe('lock_not_available');
  });

  it('classifies a lock_not_available error nested under cause', () => {
    expect(classifyPostgresError(new Error('failed', { cause: { code: '55P03' } }))).toBe('lock_not_available');
  });

  it('returns undefined for an unrecognized error code', () => {
    expect(classifyPostgresError({ code: '23505' })).toBeUndefined();
  });

  it('returns undefined for a non-object error', () => {
    expect(classifyPostgresError('boom')).toBeUndefined();
  });
});

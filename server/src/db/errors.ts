import type { GetRecordValues } from '../utils/type-utils.ts';

type PostgresErrorCode = GetRecordValues<typeof POSTGRES_ERROR_CODES>;

type PostgresInternalCode = keyof typeof POSTGRES_ERROR_CODES;

const POSTGRES_ERROR_CODES = { '55P03': 'lock_not_available' } as const;

export function classifyPostgresError(error: unknown): PostgresErrorCode | undefined {
  const code = postgresErrorCode(error);
  if (code == null) return undefined;

  return POSTGRES_ERROR_CODES[code as PostgresInternalCode];
}

function postgresErrorCode(error: unknown): string | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error) return postgresErrorCode(error.cause);
  return undefined;
}

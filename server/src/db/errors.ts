import { toError } from '../utils/results.ts';
import type { GetRecordValues } from '../utils/type-utils.ts';

const POSTGRES_ERROR_CODES = { '55P03': 'lock_not_available' } as const;

type PostgresErrorCode = GetRecordValues<typeof POSTGRES_ERROR_CODES>;

export function classifyPostgresError(error: Error): PostgresErrorCode | undefined {
  const code = postgresErrorCode(error);

  if (code === '55P03') {
    return POSTGRES_ERROR_CODES[code];
  }

  return undefined;
}

function postgresErrorCode(error: Error): string | undefined {
  if (hasPostgresErrorCode(error)) {
    return error.code;
  }

  if (error.cause != null) {
    return postgresErrorCode(toError(error.cause));
  }

  return undefined;
}

function hasPostgresErrorCode(error: Error): error is Error & { code: string } {
  if (!('code' in error)) {
    return false;
  }

  return typeof error.code === 'string';
}

import type { GetRecordValues } from '../utils/type-utils.ts';

export type ContentfulStatusCode = GetRecordValues<typeof CONTENTFUL_STATUS_CODES>;

export const CONTENTFUL_STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  LOCKED: 423,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const CONTENTLESS_STATUS_CODES = {
  NOT_MODIFIED: 304,
} as const;

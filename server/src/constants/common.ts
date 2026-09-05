import type { GetRecordValues } from '../utils/type-utils.ts';

export const REQUEST_ID_HEADER_NAME = 'tcg-request-id';

export const APP_API_ROUTE_NAME = '/app-api';

export type ServerMode = GetRecordValues<typeof SERVER_MODES>;

export const SERVER_MODES = { SERVER: 'SERVER', TEST: 'TEST' } as const;

export const PRICING_CLIENT_MODES = { REAL: 'real', STATIC: 'static' } as const;

export const OBJECT_STORAGE_PROVIDERS = { MEMORY: 'memory', S3: 's3' } as const;

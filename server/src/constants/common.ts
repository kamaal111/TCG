import type { GetRecordValues } from '../utils/type-utils.ts';

export const REQUEST_ID_HEADER_NAME = 'tcg-request-id';

export const ONE_DAY_IN_SECONDS = 60 * 60 * 24;

export const APP_API_ROUTE_NAME = '/app-api';

export type ServerMode = GetRecordValues<typeof SERVER_MODES>;

export const SERVER_MODES = { SERVER: 'SERVER', TEST: 'TEST' } as const;

export type PricingClientMode = GetRecordValues<typeof PRICING_CLIENT_MODES>;

export const PRICING_CLIENT_MODES = { REAL: 'real', STATIC: 'static' } as const;

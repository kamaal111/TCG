import { ONE_SECOND_IN_MS } from '../constants/time.ts';

export const FOREX_ROUTE_NAME = '/forex';

export const FOREX_OPENAPI_TAG = 'Forex';

export const FOREX_BASE_CURRENCY = 'EUR';

export const ECB_FEED_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

export const FOREX_REQUEST_TIMEOUT_MS = 30 * ONE_SECOND_IN_MS;

export const FOREX_COLLECTION_STATUSES = { PERSISTED: 'persisted', SKIPPED: 'skipped' } as const;

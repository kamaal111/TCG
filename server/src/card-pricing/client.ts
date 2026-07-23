import type { Result } from 'neverthrow';

import type { CardGame, PricingCardRecord, PricingSource } from './types.ts';
import type { GetRecordValues } from '../utils/type-utils.ts';

export const PRICING_CLIENT_ERROR_REASONS = {
  HTTP_ERROR: 'http_error',
  INVALID_RESPONSE: 'invalid_response',
  MISSING_CREDENTIALS: 'missing_credentials',
  NETWORK_ERROR: 'network_error',
  REQUEST_TIMEOUT: 'request_timeout',
} as const;

type PricingClientErrorReason = GetRecordValues<typeof PRICING_CLIENT_ERROR_REASONS>;

export interface PricingClientError {
  readonly reason: PricingClientErrorReason;
  readonly message: string;
  readonly statusCode?: number;
  readonly isRetryable: boolean;
}

export interface PricingSearchResult {
  readonly records: PricingCardRecord[];
  readonly providerResultCount: number;
  readonly rejectedCount: number;
  readonly missingBaseVariantCount: number;
}

export type PricingClientResult<T> = Result<T, PricingClientError>;

export interface PricingClient {
  readonly source: PricingSource;
  searchCards(game: CardGame, query: string): Promise<PricingClientResult<PricingSearchResult>>;
  getCardById(game: CardGame, id: string): Promise<PricingClientResult<PricingCardRecord | null>>;
}

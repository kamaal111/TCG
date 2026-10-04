import type { Result } from 'neverthrow';

import type { ScrydexRawCard } from './schemas.ts';

export type ScrydexGame = 'pokemon' | 'one_piece';

export const SCRYDEX_ERROR_REASONS = {
  HTTP_ERROR: 'http_error',
  INVALID_RESPONSE: 'invalid_response',
  MISSING_CREDENTIALS: 'missing_credentials',
  NETWORK_ERROR: 'network_error',
  REQUEST_TIMEOUT: 'request_timeout',
} as const;

export interface ScrydexClientError {
  readonly reason: (typeof SCRYDEX_ERROR_REASONS)[keyof typeof SCRYDEX_ERROR_REASONS];
  readonly message: string;
  readonly statusCode?: number;
  readonly isRetryable: boolean;
}

export type ScrydexClientResult<T> = Result<T, ScrydexClientError>;

export interface ScrydexSearchResult {
  readonly cards: ScrydexRawCard[];
  readonly providerResultCount: number;
  readonly rejectedCount: number;
}

export interface ScrydexLookupResult {
  readonly card: ScrydexRawCard;
  readonly statusCode: number;
}

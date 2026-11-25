import type { Result } from 'neverthrow';

import type { ScrydexRawCard } from './schemas.ts';

export const SCRYDEX_FIRST_PAGE = 1;

export const SCRYDEX_SEARCH_PAGE_SIZE = 100;

export const SCRYDEX_PRICE_TYPE_MAP = {
  RAW: 'raw',
  GRADED: 'graded',
} as const;

export const SCRYDEX_RAW_CONDITION_MAP = {
  NEAR_MINT: 'NM',
  LIGHTLY_PLAYED: 'LP',
  MODERATELY_PLAYED: 'MP',
  HEAVILY_PLAYED: 'HP',
  DAMAGED: 'DM',
} as const;

export const SCRYDEX_GAME_MAP = {
  POKEMON: 'pokemon',
  ONE_PIECE: 'one_piece',
} as const;

export type ScrydexGame = (typeof SCRYDEX_GAME_MAP)[keyof typeof SCRYDEX_GAME_MAP];

export const SCRYDEX_CATALOG_COLLECTION_MAP = {
  CARDS: 'cards',
  EXPANSIONS: 'expansions',
} as const;

export type ScrydexCatalogCollection =
  (typeof SCRYDEX_CATALOG_COLLECTION_MAP)[keyof typeof SCRYDEX_CATALOG_COLLECTION_MAP];

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
  readonly catalogTotal?: number;
  readonly hasMore: boolean;
  readonly rejectedCount: number;
}

export interface ScrydexLookupResult {
  readonly card: ScrydexRawCard;
  readonly statusCode: number;
}

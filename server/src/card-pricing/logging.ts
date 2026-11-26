import { type DomainLogFields, type DomainLogger, getDomainLogger } from '@tcg/http/logging';

import type { PricingProviderOperation } from './client.ts';
import type { PricingIdentity } from './coordinator.ts';
import type { CardGame, PricingSource } from './types.ts';
import type { HonoContext } from '../context.ts';
import type { GetRecordValues } from '../utils/type-utils.ts';

export const PRICING_EVENT_MAP = {
  SEARCH_COMPLETED: 'pricing.search.completed',
  SEARCH_CACHE: 'pricing.search.cache',
  OWNED_CACHE: 'pricing.owned.cache',
  LOCK_COMPLETED: 'pricing.lock.completed',
  LOCK_POOL_ERROR: 'pricing.lock.pool_error',
  PROVIDER_REQUEST_COMPLETED: 'pricing.provider.request_completed',
} as const;

export const PRICING_CACHE_STATUS_MAP = {
  HIT: 'hit',
  MISS: 'miss',
  SET: 'set',
} as const;

export type PricingLogFields = DomainLogFields<GetRecordValues<typeof PRICING_EVENT_MAP>> & {
  card_id?: string;
  game?: CardGame;
  priced_on?: string;
  pricing_source?: PricingSource;
  cache_status?: GetRecordValues<typeof PRICING_CACHE_STATUS_MAP>;
  result_count?: number;
  priced_count?: number;
  rejected_count?: number;
  missing_base_variant_count?: number;
  provider?: string;
  provider_operation?: PricingProviderOperation;
  provider_result_count?: number;
  provider_error_reason?: string;
  provider_error_message?: string;
  provider_status_code?: number;
  is_retryable?: boolean;
  lock_key_type?: PricingIdentity['keyType'];
  lock_status?: 'acquired' | 'failed' | 'timeout';
  lock_wait_ms?: number;
};

export const pricingLogger = (c: HonoContext): DomainLogger<PricingLogFields> => getDomainLogger(c);

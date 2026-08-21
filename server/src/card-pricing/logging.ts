import type { CardGame, PricingSource } from './types.ts';
import type { HonoContext } from '../context.ts';
import { type DomainLogFields, type DomainLogger, getDomainLogger } from '../logging/index.ts';

export const PRICING_EVENTS = [
  'pricing.search.completed',
  'pricing.search.cache',
  'pricing.owned.cache',
  'pricing.lock.completed',
  'pricing.provider.request_completed',
] as const;

export type PricingLogFields = DomainLogFields<(typeof PRICING_EVENTS)[number]> & {
  card_id?: string;
  game?: CardGame;
  priced_on?: string;
  pricing_source?: PricingSource;
  cache_status?: 'hit' | 'miss' | 'set';
  result_count?: number;
  priced_count?: number;
  rejected_count?: number;
  missing_base_variant_count?: number;
  provider?: string;
  provider_operation?: 'card_lookup' | 'search';
  provider_result_count?: number;
  provider_error_reason?: string;
  provider_error_message?: string;
  provider_status_code?: number;
  is_retryable?: boolean;
  lock_key_type?: 'card' | 'search';
  lock_status?: 'acquired' | 'failed' | 'timeout';
  lock_wait_ms?: number;
};

export const pricingLogger = (c: HonoContext): DomainLogger<PricingLogFields> => getDomainLogger(c);

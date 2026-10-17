import { sql } from 'drizzle-orm';
import { z } from 'zod';

export const CURRENCY_CODES = [
  'EUR',
  'USD',
  'JPY',
  'CZK',
  'DKK',
  'GBP',
  'HUF',
  'PLN',
  'RON',
  'SEK',
  'CHF',
  'ISK',
  'NOK',
  'TRY',
  'AUD',
  'BRL',
  'CAD',
  'CNY',
  'HKD',
  'IDR',
  'ILS',
  'INR',
  'KRW',
  'MXN',
  'MYR',
  'NZD',
  'PHP',
  'SGD',
  'THB',
  'ZAR',
] as const;

export const DEFAULT_PREFERRED_CURRENCY = 'USD';

export const CurrencySchema = z.enum(CURRENCY_CODES).meta({
  $id: 'Currency',
  title: 'Currency',
  description: 'ISO 4217 currency supported by ECB conversion.',
});

export type Currency = z.infer<typeof CurrencySchema>;

export const currencyConstraint = sql.raw(`('${CURRENCY_CODES.join("', '")}')`);

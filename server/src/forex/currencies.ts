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

export const CurrencySchema = z.enum(CURRENCY_CODES).meta({
  $id: 'Currency',
  title: 'Currency',
  description: 'ISO 4217 currency supported by ECB conversion.',
});

export const NullableCurrencySchema = z.enum(CURRENCY_CODES).nullable().meta({
  $id: 'NullableCurrency',
  title: 'Nullable Currency',
});

export type Currency = z.infer<typeof CurrencySchema>;

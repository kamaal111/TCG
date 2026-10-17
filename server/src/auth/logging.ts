import type { HonoContext } from '../context.ts';
import type { Currency } from '../forex/currencies.ts';
import { type DomainLogFields, type DomainLogger, getDomainLogger } from '../logging/index.ts';

export const AUTH_PREFERENCES_EVENTS = ['auth.preferences.completed'] as const;

type PreferencesLogFields = DomainLogFields<(typeof AUTH_PREFERENCES_EVENTS)[number]> & {
  preference_action?: 'initialize' | 'update';
  requested_currency?: Currency;
  preferred_currency?: Currency;
};

export const preferencesLogger = (c: HonoContext): DomainLogger<PreferencesLogFields> => getDomainLogger(c);

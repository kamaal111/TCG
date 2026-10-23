import type { Currency } from '../forex/currencies.ts';

export interface UserPreferencesRepository {
  findPreferredCurrency(): Promise<Currency | undefined>;
  initializePreferredCurrency(currency: Currency): Promise<Currency>;
  updatePreferredCurrency(currency: Currency): Promise<Currency>;
}

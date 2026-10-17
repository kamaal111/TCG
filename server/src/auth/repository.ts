import { eq } from 'drizzle-orm';

import type { HonoContext } from '../context.ts';
import { getSession } from './module.ts';
import { userPreferences } from '../db/schema/forex.ts';
import type { Currency } from '../forex/currencies.ts';

export class UserPreferencesRepository {
  private readonly c: HonoContext;

  constructor(c: HonoContext) {
    this.c = c;
  }

  private get db() {
    return this.c.get('db');
  }

  private get userId() {
    return getSession(this.c).user.id;
  }

  async findPreferredCurrency(userId: string): Promise<Currency | undefined> {
    const saved = await this.db.query.userPreferences.findFirst({
      columns: { preferredCurrency: true },
      where: { userId },
    });

    return saved?.preferredCurrency;
  }

  async initializePreferredCurrency(preferredCurrency: Currency): Promise<Currency> {
    await this.preferenceInsert(preferredCurrency).onConflictDoNothing();

    return this.savedPreferredCurrency();
  }

  async updatePreferredCurrency(preferredCurrency: Currency): Promise<Currency> {
    await this.preferenceInsert(preferredCurrency).onConflictDoUpdate({
      target: userPreferences.userId,
      set: { preferredCurrency },
      setWhere: eq(userPreferences.userId, this.userId),
    });

    return this.savedPreferredCurrency();
  }

  private preferenceInsert(preferredCurrency: Currency) {
    return this.db.insert(userPreferences).values({ userId: this.userId, preferredCurrency });
  }

  private async savedPreferredCurrency(): Promise<Currency> {
    const saved = await this.findPreferredCurrency(this.userId);

    if (saved == null) {
      throw new Error('The saved currency preference could not be read');
    }

    return saved;
  }
}

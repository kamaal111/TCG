import { eq } from 'drizzle-orm';

import type { HonoContext } from '../context.ts';
import { getSession } from './module.ts';
import { userPreferences } from '../db/schema/forex.ts';
import type { Currency } from '../forex/currencies.ts';

interface SavePreferenceOptions {
  preferredCurrency: Currency;
  onlyIfUnset: boolean;
}

export class UserPreferencesRepository {
  private readonly c: HonoContext;

  constructor(c: HonoContext) {
    this.c = c;
  }

  async savePreferredCurrency(options: SavePreferenceOptions): Promise<Currency> {
    const userId = getSession(this.c).user.id;
    const db = this.c.get('db');
    const insert = db.insert(userPreferences).values({ userId, preferredCurrency: options.preferredCurrency });

    if (options.onlyIfUnset) {
      await insert.onConflictDoNothing();
    } else {
      await insert.onConflictDoUpdate({
        target: userPreferences.userId,
        set: { preferredCurrency: options.preferredCurrency },
        setWhere: eq(userPreferences.userId, userId),
      });
    }

    const [saved] = await db
      .select({ preferredCurrency: userPreferences.preferredCurrency })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    if (saved == null) {
      throw new Error('The saved currency preference could not be read');
    }

    return saved.preferredCurrency;
  }
}

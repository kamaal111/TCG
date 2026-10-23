import { eq } from 'drizzle-orm';

import type { UserPreferencesRepository } from '../../auth/repository.ts';
import type { Database } from '../../db/index.ts';
import { userPreferences } from '../../db/schema/forex.ts';
import { InternalServerError } from '../../exceptions/index.ts';
import type { Currency } from '../../forex/currencies.ts';
import type { AuthenticatedIdentity } from '../contracts.ts';

export class PostgresUserPreferencesRepository implements UserPreferencesRepository {
  private readonly db: Database;
  private readonly identity: AuthenticatedIdentity;

  constructor(db: Database, identity: AuthenticatedIdentity) {
    this.db = db;
    this.identity = identity;
  }

  private get userId() {
    return this.identity.requireUserId();
  }

  async findPreferredCurrency(): Promise<Currency | undefined> {
    const saved = await this.db.query.userPreferences.findFirst({
      columns: { preferredCurrency: true },
      where: { userId: this.userId },
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
    const saved = await this.findPreferredCurrency();

    if (saved == null) {
      throw new InternalServerError(undefined, {
        diagnosticMessage: 'The saved currency preference could not be read',
      });
    }

    return saved;
  }
}

import type { Database } from '../../db/index.ts';
import { exchangeRate } from '../../db/schema/forex.ts';

export async function seedExchangeRate(db: Database, overrides: Partial<typeof exchangeRate.$inferInsert> = {}) {
  await db.insert(exchangeRate).values({
    date: '2026-10-16',
    rates: { EUR: 1, USD: 1.25, JPY: 150 },
    ...overrides,
  });
}

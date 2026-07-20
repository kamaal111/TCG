import { and, eq } from 'drizzle-orm';

import { getSessionWhereSessionIsRequired } from '../auth/utils/session.ts';
import type { HonoContext } from '../context.ts';
import { card, cardConditionQuantity } from '../db/schema/index.ts';
import type { UpsertCard } from './schemas/payloads.ts';

export type CardRow = typeof card.$inferSelect;
export type CardConditionQuantityRow = typeof cardConditionQuantity.$inferSelect;
export type CardWithQuantities = CardRow & { quantities: CardConditionQuantityRow[] };

export async function listCardsForSessionUser(c: HonoContext): Promise<CardWithQuantities[]> {
  const { db, userId } = getSessionScopedDatabase(c);

  return db.query.card.findMany({
    where: { userId },
    with: { quantities: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getCardForSessionUser(c: HonoContext, cardId: string): Promise<CardWithQuantities | undefined> {
  const { db, userId } = getSessionScopedDatabase(c);

  return db.query.card.findFirst({
    where: { id: cardId, userId },
    with: { quantities: true },
  });
}

export async function createCardForSessionUser(c: HonoContext, values: UpsertCard): Promise<CardWithQuantities> {
  const { db, userId } = getSessionScopedDatabase(c);

  return db.transaction(async tx => {
    const [insertedCard] = await tx
      .insert(card)
      .values({
        userId,
        game: values.game,
        name: values.name,
        setName: values.set_name,
        cardNumber: values.card_number,
        notes: values.notes ?? null,
      })
      .returning();
    if (insertedCard == null) {
      throw new Error('Failed to insert card');
    }

    const quantities = await tx
      .insert(cardConditionQuantity)
      .values(values.quantities.map(quantity => ({ ...quantity, cardId: insertedCard.id })))
      .returning();

    return { ...insertedCard, quantities };
  });
}

export async function updateCardReplacingQuantitiesForSessionUser(
  c: HonoContext,
  cardId: string,
  values: UpsertCard,
): Promise<CardWithQuantities | undefined> {
  const { db, userId } = getSessionScopedDatabase(c);

  return db.transaction(async tx => {
    const [updatedCard] = await tx
      .update(card)
      .set({
        game: values.game,
        name: values.name,
        setName: values.set_name,
        cardNumber: values.card_number,
        notes: values.notes ?? null,
      })
      .where(and(eq(card.id, cardId), eq(card.userId, userId)))
      .returning();
    if (updatedCard == null) {
      return undefined;
    }

    await tx.delete(cardConditionQuantity).where(eq(cardConditionQuantity.cardId, updatedCard.id));
    const quantities = await tx
      .insert(cardConditionQuantity)
      .values(values.quantities.map(quantity => ({ ...quantity, cardId: updatedCard.id })))
      .returning();

    return { ...updatedCard, quantities };
  });
}

export async function deleteCardForSessionUser(c: HonoContext, cardId: string): Promise<boolean> {
  const { db, userId } = getSessionScopedDatabase(c);

  const deletedRows = await db
    .delete(card)
    .where(and(eq(card.id, cardId), eq(card.userId, userId)))
    .returning({ id: card.id });

  return deletedRows.length > 0;
}

function getSessionScopedDatabase(c: HonoContext) {
  const userId = getSessionWhereSessionIsRequired(c).user.id;
  const db = c.get('db');

  return { db, userId };
}

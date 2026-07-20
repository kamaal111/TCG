import assert from 'node:assert/strict';

import { and, eq } from 'drizzle-orm';

import type { HonoContext } from '../context.ts';
import { card, cardConditionQuantity } from '../db/schema/cards.ts';
import { getSessionWhereSessionIsRequired } from '../auth/utils/session.ts';
import type { UpsertCard } from './schemas/payloads.ts';

export type CardWithQuantities = typeof card.$inferSelect & {
  quantities: (typeof cardConditionQuantity.$inferSelect)[];
};

export class CardRepository {
  /**
   * Lists every card owned by the current session user, newest first.
   *
   * @param c Request context containing the authenticated session and database.
   * @returns The user's cards with their condition quantities.
   */
  static list(c: HonoContext): Promise<CardWithQuantities[]> {
    const userId = getSessionWhereSessionIsRequired(c).user.id;
    return c.get('db').query.card.findMany({
      where: { userId },
      with: { quantities: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Gets a card when it is owned by the current session user.
   *
   * @param c Request context containing the authenticated session and database.
   * @param cardId Card identifier.
   * @returns The card with its condition quantities, or undefined when absent.
   */
  static get(c: HonoContext, cardId: string): Promise<CardWithQuantities | undefined> {
    const userId = getSessionWhereSessionIsRequired(c).user.id;
    return c.get('db').query.card.findFirst({
      where: { id: cardId, userId },
      with: { quantities: true },
    });
  }

  /**
   * Creates a card and its condition quantities for the current session user.
   *
   * @param c Request context containing the authenticated session and database.
   * @param values Card fields and condition quantities to persist.
   * @returns The created card with its condition quantities.
   */
  static create(c: HonoContext, values: UpsertCard): Promise<CardWithQuantities> {
    const userId = getSessionWhereSessionIsRequired(c).user.id;
    return c.get('db').transaction(async tx => {
      const [createdCard] = await tx
        .insert(card)
        .values({
          userId,
          game: values.game,
          name: values.name,
          setName: values.set_name,
          cardNumber: values.card_number,
          notes: values.notes,
        })
        .returning();
      assert(createdCard, 'Card insert did not return a row');

      const quantities = await tx
        .insert(cardConditionQuantity)
        .values(values.quantities.map(quantity => ({ cardId: createdCard.id, ...quantity })))
        .returning();
      return { ...createdCard, quantities };
    });
  }

  /**
   * Replaces a card and its condition quantities when owned by the current session user.
   *
   * @param c Request context containing the authenticated session and database.
   * @param cardId Card identifier.
   * @param values Replacement card fields and condition quantities.
   * @returns The updated card with its condition quantities, or undefined when absent.
   */
  static update(c: HonoContext, cardId: string, values: UpsertCard): Promise<CardWithQuantities | undefined> {
    const userId = getSessionWhereSessionIsRequired(c).user.id;
    return c.get('db').transaction(async tx => {
      const [updatedCard] = await tx
        .update(card)
        .set({
          game: values.game,
          name: values.name,
          setName: values.set_name,
          cardNumber: values.card_number,
          notes: values.notes ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(card.id, cardId), eq(card.userId, userId)))
        .returning();
      if (updatedCard == null) return undefined;

      await tx.delete(cardConditionQuantity).where(eq(cardConditionQuantity.cardId, cardId));
      const quantities = await tx
        .insert(cardConditionQuantity)
        .values(values.quantities.map(quantity => ({ cardId, ...quantity })))
        .returning();
      return { ...updatedCard, quantities };
    });
  }

  /**
   * Deletes a card when it is owned by the current session user.
   *
   * @param c Request context containing the authenticated session and database.
   * @param cardId Card identifier.
   * @returns Whether a card was deleted.
   */
  static async delete(c: HonoContext, cardId: string): Promise<boolean> {
    const userId = getSessionWhereSessionIsRequired(c).user.id;
    const deleted = await c
      .get('db')
      .delete(card)
      .where(and(eq(card.id, cardId), eq(card.userId, userId)))
      .returning({ id: card.id });
    return deleted.length > 0;
  }
}

import assert from 'node:assert/strict';

import { and, eq, sql } from 'drizzle-orm';

import type { HonoContext } from '../context.ts';
import type { CardGame } from './schemas/params.ts';
import type { UpsertCard } from './schemas/payloads.ts';
import { getSession } from '../auth/module.ts';
import { card, cardConditionQuantity } from '../db/schema/cards.ts';

export type CardWithQuantities = typeof card.$inferSelect & {
  quantities: (typeof cardConditionQuantity.$inferSelect)[];
};

export class CardRepository {
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

  /**
   * Lists every card owned by the current session user, newest first.
   *
   * @param game Optional game to filter by.
   * @returns The user's cards with their condition quantities.
   */
  list(game?: CardGame): Promise<CardWithQuantities[]> {
    const where = game != null ? { userId: this.userId, game } : { userId: this.userId };

    return this.db.query.card.findMany({ where, with: { quantities: true }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Gets a card when it is owned by the current session user.
   *
   * @param cardId Card identifier.
   * @returns The card with its condition quantities, or undefined when absent.
   */
  get(cardId: string): Promise<CardWithQuantities | undefined> {
    return this.db.query.card.findFirst({ where: { id: cardId, userId: this.userId }, with: { quantities: true } });
  }

  /**
   * Creates a card and its condition quantities for the current session user.
   *
   * @param values Card fields and condition quantities to persist.
   * @returns The created card with its condition quantities.
   */
  create(values: UpsertCard): Promise<CardWithQuantities> {
    return this.db.transaction(async tx => {
      const [createdCard] = await tx
        .insert(card)
        .values({
          userId: this.userId,
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
   * @param cardId Card identifier.
   * @param values Replacement card fields and condition quantities.
   * @returns The updated card with its condition quantities, or undefined when absent.
   */
  update(cardId: string, values: UpsertCard): Promise<CardWithQuantities | undefined> {
    return this.db.transaction(async tx => {
      const [updatedCard] = await tx
        .update(card)
        .set({
          game: values.game,
          name: values.name,
          setName: values.set_name,
          cardNumber: values.card_number,
          notes: values.notes ?? null,
          updatedAt: new Date(),
          // Clears a stale provider link so pricing re-resolves the identity for changed card details.
          pricingCardId: sql`case
            when ${card.game} = ${values.game} and ${card.name} = ${values.name} and ${card.cardNumber} = ${values.card_number}
            then ${card.pricingCardId}
            else null
          end`,
          pricingSource: sql`case
            when ${card.game} = ${values.game} and ${card.name} = ${values.name} and ${card.cardNumber} = ${values.card_number}
            then ${card.pricingSource}
            else null
          end`,
        })
        .where(and(eq(card.id, cardId), eq(card.userId, this.userId)))
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
   * @param cardId Card identifier.
   * @returns Whether a card was deleted.
   */
  async delete(cardId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(card)
      .where(and(eq(card.id, cardId), eq(card.userId, this.userId)))
      .returning({ id: card.id });

    return deleted.length > 0;
  }
}

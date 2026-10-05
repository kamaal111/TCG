import assert from 'node:assert/strict';

import { and, desc, eq, getColumns, inArray, sql } from 'drizzle-orm';

import type { HonoContext } from '../context.ts';
import type { CardGame } from './schemas/params.ts';
import type { UpsertCard } from './schemas/payloads.ts';
import { getSession } from '../auth/module.ts';
import { card, cardConditionQuantity } from '../db/schema/cards.ts';

export type CardWithQuantities = typeof card.$inferSelect & {
  quantities: (typeof cardConditionQuantity.$inferSelect)[];
};

interface CardCollection {
  cards: CardWithQuantities[];
  availableSetNames: string[];
}

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
   * Returns matching owned cards, newest first, and all game-scoped set choices
   * from one database snapshot. Set choices do not depend on the set filter.
   */
  async listCollection(game: CardGame | undefined, setNames: string[]): Promise<CardCollection> {
    const ownedCards = this.db.$with('collection_cards').as(
      this.db
        .select()
        .from(card)
        .where(and(eq(card.userId, this.userId), game != null ? eq(card.game, game) : undefined)),
    );

    const sets = this.db.$with('collection_sets').as(
      this.db
        .selectDistinct({
          name: ownedCards.setName,
          position: sql`dense_rank() over (order by ${ownedCards.setName})`.mapWith(Number).as('position'),
        })
        .from(ownedCards),
    );

    const uniqueSetNames = new Set(setNames);

    const setNamesInArray =
      uniqueSetNames.size > 0 ? inArray(ownedCards.setName, uniqueSetNames.values().toArray()) : undefined;

    const rows = await this.db
      .with(ownedCards, sets)
      .select({
        setName: sets.name,
        setPosition: sets.position,
        card: getColumns(ownedCards),
        quantity: getColumns(cardConditionQuantity),
      })
      .from(sets)
      .leftJoin(ownedCards, and(eq(ownedCards.setName, sets.name), setNamesInArray))
      .leftJoin(cardConditionQuantity, eq(cardConditionQuantity.cardId, ownedCards.id))
      .orderBy(desc(ownedCards.createdAt));

    const reducedResult = rows.reduce(
      (acc, row) => {
        acc.namesByPosition.set(row.setPosition, row.setName);

        if (row.card == null) {
          return acc;
        }

        let ownedCard = acc.cardsById.get(row.card.id);

        if (ownedCard == null) {
          ownedCard = { ...row.card, quantities: [] };
          acc.cardsById.set(ownedCard.id, ownedCard);
        }

        if (row.quantity != null) {
          ownedCard.quantities.push(row.quantity);
        }

        return acc;
      },
      {
        cardsById: new Map<string, CardWithQuantities>(),
        namesByPosition: new Map<number, string>(),
      },
    );

    return {
      cards: reducedResult.cardsById.values().toArray(),
      availableSetNames: reducedResult.namesByPosition
        .entries()
        .toArray()
        .toSorted(([a], [b]) => a - b)
        .map(([, name]) => name),
    };
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

      if (updatedCard == null) {
        return undefined;
      }

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

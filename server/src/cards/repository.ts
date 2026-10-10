import assert from 'node:assert/strict';

import { and, desc, eq, getColumns, inArray, isNull, notInArray, sql } from 'drizzle-orm';

import { getSession } from '../auth/module.ts';
import type { OwnedCardPriceResponse } from '../card-pricing/schemas/responses.ts';
import type { HonoContext } from '../context.ts';
import { CardNotFound } from './exceptions.ts';
import type { CardGame } from './schemas/params.ts';
import type { UpsertCard } from './schemas/payloads.ts';
import type { DeleteCardsResponse } from './schemas/responses.ts';
import { marketPurchaseAmount } from './utils/purchase-price.ts';
import { purchaseQuantities } from './utils/quantities.ts';
import { card, cardConditionQuantity, cardPurchaseBatch } from '../db/schema/cards.ts';

export type CardWithPurchases = typeof card.$inferSelect & {
  purchaseBatches: Pick<
    typeof cardPurchaseBatch.$inferSelect,
    'id' | 'cardId' | 'condition' | 'quantity' | 'purchasePrice' | 'currency' | 'automaticPriceDate'
  >[];
};

interface CardCollection {
  cards: CardWithPurchases[];
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
    return this.db.transaction(
      async tx => {
        const ownedCards = tx.$with('collection_cards').as(
          tx
            .select()
            .from(card)
            .where(and(eq(card.userId, this.userId), game != null ? eq(card.game, game) : undefined)),
        );

        const sets = tx.$with('collection_sets').as(
          tx
            .selectDistinct({
              name: ownedCards.setName,
              position: sql`dense_rank() over (order by ${ownedCards.setName})`.mapWith(Number).as('position'),
            })
            .from(ownedCards),
        );

        const uniqueSetNames = new Set(setNames);

        const setNamesInArray =
          uniqueSetNames.size > 0 ? inArray(ownedCards.setName, uniqueSetNames.values().toArray()) : undefined;

        const rows = await tx
          .with(ownedCards, sets)
          .select({
            setName: sets.name,
            setPosition: sets.position,
            card: getColumns(ownedCards),
          })
          .from(sets)
          .leftJoin(ownedCards, and(eq(ownedCards.setName, sets.name), setNamesInArray))
          .orderBy(desc(ownedCards.createdAt));

        const reducedResult = rows.reduce(
          (acc, row) => {
            acc.namesByPosition.set(row.setPosition, row.setName);

            if (row.card == null) {
              return acc;
            }

            let ownedCard = acc.cardsById.get(row.card.id);

            if (ownedCard == null) {
              ownedCard = { ...row.card, purchaseBatches: [] };
              acc.cardsById.set(ownedCard.id, ownedCard);
            }

            return acc;
          },
          {
            cardsById: new Map<string, CardWithPurchases>(),
            namesByPosition: new Map<number, string>(),
          },
        );

        const cards = reducedResult.cardsById.values().toArray();

        if (cards.length > 0) {
          const batches = await tx
            .select({
              id: cardPurchaseBatch.id,
              cardId: cardPurchaseBatch.cardId,
              condition: cardPurchaseBatch.condition,
              quantity: cardPurchaseBatch.quantity,
              purchasePrice: cardPurchaseBatch.purchasePrice,
              currency: cardPurchaseBatch.currency,
              automaticPriceDate: cardPurchaseBatch.automaticPriceDate,
            })
            .from(cardPurchaseBatch)
            .innerJoin(card, eq(cardPurchaseBatch.cardId, card.id))
            .where(
              and(
                eq(card.userId, this.userId),
                inArray(
                  card.id,
                  cards.map(row => row.id),
                ),
              ),
            )
            .orderBy(cardPurchaseBatch.createdAt, cardPurchaseBatch.id);

          for (const batch of batches) {
            reducedResult.cardsById.get(batch.cardId)?.purchaseBatches.push(batch);
          }
        }

        return {
          cards: reducedResult.cardsById.values().toArray(),
          availableSetNames: reducedResult.namesByPosition
            .entries()
            .toArray()
            .toSorted(([a], [b]) => a - b)
            .map(([, name]) => name),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  /**
   * Gets a card when it is owned by the current session user.
   *
   * @param cardId Card identifier.
   * @returns The card with its purchases, or undefined when absent.
   */
  get(cardId: string): Promise<CardWithPurchases | undefined> {
    return this.db.query.card.findFirst({
      where: { id: cardId, userId: this.userId },
      with: { purchaseBatches: true },
    });
  }

  /**
   * Creates a card and its purchases for the current session user.
   *
   * @param values Card fields and purchases to persist.
   * @returns The created card with its purchases.
   */
  create(values: UpsertCard): Promise<CardWithPurchases> {
    if (values.purchases.some(batch => batch.id != null)) {
      throw new CardNotFound(this.c);
    }

    return this.db.transaction(async tx => {
      const [createdCard] = await tx
        .insert(card)
        .values({
          userId: this.userId,
          ...cardFields(values),
        })
        .returning();

      assert(createdCard, 'Card insert did not return a row');

      await tx
        .insert(cardConditionQuantity)
        .values(purchaseQuantities(values.purchases).map(quantity => ({ cardId: createdCard.id, ...quantity })));

      const purchaseBatches = await tx
        .insert(cardPurchaseBatch)
        .values(values.purchases.map(batch => purchaseBatchFields(createdCard.id, batch)))
        .returning();

      return { ...createdCard, purchaseBatches };
    });
  }

  /**
   * Replaces a card and its purchases when owned by the current session user.
   *
   * @param cardId Card identifier.
   * @param values Replacement card fields and purchases.
   * @returns The updated card with its purchases, or undefined when absent.
   */
  update(cardId: string, values: UpsertCard): Promise<CardWithPurchases | undefined> {
    return this.db.transaction(async tx => {
      const [ownedCard] = await tx
        .select()
        .from(card)
        .where(and(eq(card.id, cardId), eq(card.userId, this.userId)))
        .for('update');

      if (ownedCard == null) {
        return undefined;
      }

      const previousBatches = await tx.select().from(cardPurchaseBatch).where(eq(cardPurchaseBatch.cardId, cardId));
      const previousById = new Map(previousBatches.map(batch => [batch.id, batch]));

      if (values.purchases.some(batch => batch.id != null && !previousById.has(batch.id))) {
        throw new CardNotFound(this.c);
      }

      const [updatedCard] = await tx
        .update(card)
        .set({
          ...cardFields(values),
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

      await tx
        .insert(cardConditionQuantity)
        .values(purchaseQuantities(values.purchases).map(quantity => ({ cardId, ...quantity })));

      const inputs = values.purchases;

      const retainedIds = inputs.flatMap(batch => (batch.id == null ? [] : [batch.id]));
      await tx
        .delete(cardPurchaseBatch)
        .where(
          and(
            eq(cardPurchaseBatch.cardId, cardId),
            retainedIds.length > 0 ? notInArray(cardPurchaseBatch.id, retainedIds) : undefined,
          ),
        );

      const purchaseBatches = await tx
        .insert(cardPurchaseBatch)
        .values(
          inputs.map(batch => {
            const previous = batch.id != null ? previousById.get(batch.id) : undefined;

            const unchangedPrice =
              previous?.purchasePrice === (batch.purchase_price != null ? decimalScale(batch.purchase_price) : null) &&
              previous?.currency === batch.currency;

            return {
              ...purchaseBatchFields(cardId, batch),
              automaticPriceDate: unchangedPrice ? previous?.automaticPriceDate : null,
            };
          }),
        )
        .onConflictDoUpdate({
          target: cardPurchaseBatch.id,
          set: {
            condition: sql`excluded.condition`,
            quantity: sql`excluded.quantity`,
            purchasePrice: sql`excluded.purchase_price`,
            currency: sql`excluded.currency`,
            automaticPriceDate: sql`excluded.automatic_price_date`,
            updatedAt: new Date(),
          },
        })
        .returning();

      return { ...updatedCard, purchaseBatches };
    });
  }

  /** Fills missing costs with this request's daily average in one conditional write. */
  async backfillPurchasePrices(cards: CardWithPurchases[], prices: readonly OwnedCardPriceResponse[]): Promise<void> {
    const priceById = new Map(prices.map(price => [price.card_id, price]));

    const candidates = cards.flatMap(owned => {
      const price = priceById.get(owned.id)?.priced_card;

      if (price?.market?.market == null || !owned.purchaseBatches.some(batch => batch.purchasePrice == null)) {
        return [];
      }

      const amount = marketPurchaseAmount(price.market.market);

      if (amount == null) {
        return [];
      }

      return [
        sql`(${owned.id}, ${owned.game}, ${owned.name}, ${owned.cardNumber}, ${amount}, ${price.market.currency}, ${price.priced_on.slice(0, 10)})`,
      ];
    });

    if (candidates.length === 0) {
      return;
    }

    const input = this.db.$with('purchase_price_input').as(
      this.db
        .select({
          cardId: sql<string>`input.card_id`.as('card_id'),
          game: sql<string>`input.game`.as('game'),
          name: sql<string>`input.name`.as('name'),
          cardNumber: sql<string>`input.card_number`.as('card_number'),
          amount: sql<string>`input.amount`.as('amount'),
          currency: sql<string>`input.currency`.as('currency'),
          pricedOn: sql<string>`input.priced_on`.as('priced_on'),
        })
        .from(
          sql`(values ${sql.join(candidates, sql`, `)}) as input(card_id, game, name, card_number, amount, currency, priced_on)`,
        ),
    );

    const eligible = this.db.$with('eligible_purchase_prices').as(
      this.db
        .select({ cardId: input.cardId, amount: input.amount, currency: input.currency, pricedOn: input.pricedOn })
        .from(input)
        .innerJoin(
          card,
          and(
            eq(card.id, input.cardId),
            eq(sql`${card.game}::text`, input.game),
            eq(card.name, input.name),
            eq(card.cardNumber, input.cardNumber),
          ),
        )
        .where(eq(card.userId, this.userId))
        .orderBy(card.id)
        .for('update', { of: card }),
    );

    const result = await this.db
      .with(input, eligible)
      .update(cardPurchaseBatch)
      .set({
        purchasePrice: sql`${eligible.amount}::numeric`,
        currency: sql`${eligible.currency}`,
        automaticPriceDate: sql`${eligible.pricedOn}::date`,
        updatedAt: sql`now()`,
      })
      .from(eligible)
      .where(and(eq(cardPurchaseBatch.cardId, eligible.cardId), isNull(cardPurchaseBatch.purchasePrice)))
      .returning({
        id: cardPurchaseBatch.id,
        purchasePrice: cardPurchaseBatch.purchasePrice,
        currency: cardPurchaseBatch.currency,
        automaticPriceDate: cardPurchaseBatch.automaticPriceDate,
      });

    const updated = new Map(result.map(row => [row.id, row]));

    for (const owned of cards) {
      for (const batch of owned.purchaseBatches) {
        const row = updated.get(batch.id);

        if (row != null) {
          Object.assign(batch, row);
        }
      }
    }
  }

  async delete(cardIds: string[]): Promise<DeleteCardsResponse> {
    const ids = new Set(cardIds).values().toArray();

    if (ids.length === 0) {
      return { deleted_ids: [], not_found_ids: [] };
    }

    const deleted = await this.db
      .delete(card)
      .where(and(inArray(card.id, ids), eq(card.userId, this.userId)))
      .returning({ id: card.id });

    const deletedIds = new Set(deleted.map(row => row.id));

    return ids.reduce<DeleteCardsResponse>(
      (acc, id) => {
        if (deletedIds.has(id)) {
          acc.deleted_ids.push(id);
        } else {
          acc.not_found_ids.push(id);
        }

        return acc;
      },
      { deleted_ids: [], not_found_ids: [] },
    );
  }
}

function decimalScale(amount: string): string {
  const [whole, fraction = ''] = amount.split('.');

  return `${whole}.${fraction.padEnd(6, '0')}`;
}

function cardFields(values: UpsertCard) {
  return {
    game: values.game,
    name: values.name,
    setName: values.set_name,
    cardNumber: values.card_number,
    notes: values.notes ?? null,
  };
}

function purchaseBatchFields(cardId: string, batch: UpsertCard['purchases'][number]) {
  return {
    id: batch.id,
    cardId,
    condition: batch.condition,
    quantity: batch.quantity,
    purchasePrice: batch.purchase_price,
    currency: batch.currency,
  };
}

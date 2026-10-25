import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { omit } from '@kamaalio/kamaal/objects';
import { and, eq, getColumns, inArray, isNull, notInArray, sql } from 'drizzle-orm';

import type { OwnedCardPriceResponse } from '../../card-pricing/schemas/responses.ts';
import { CardNotFound } from '../../cards/exceptions.ts';
import type { CardImportProgress } from '../../cards/logging.ts';
import {
  pricingLinkFields,
  decimalScale,
  cardFields,
  purchaseBatchFields,
  importMatches,
} from '../../cards/policies.ts';
import type { CardRepository } from '../../cards/repository.ts';
import type { CardsPaginationQuery, CardGame } from '../../cards/schemas/params.ts';
import type { ImportCard, UpsertCard } from '../../cards/schemas/payloads.ts';
import type { DeleteCardsResponse, ImportCardsResponse } from '../../cards/schemas/responses.ts';
import type { CardWithPurchases, CardCollection } from '../../cards/types.ts';
import { encodeCardCursor } from '../../cards/utils/pagination.ts';
import { marketPurchaseAmount } from '../../cards/utils/purchase-price.ts';
import { purchaseQuantities } from '../../cards/utils/quantities.ts';
import { DEFAULT_IMPORT_POLICY, type ApplicationConfig } from '../../config.ts';
import type { Database } from '../../db/index.ts';
import { card, cardConditionQuantity, cardPurchaseBatch } from '../../db/schema/cards.ts';
import type { AuthenticatedIdentity, RepositoryDiagnostics } from '../contracts.ts';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type PurchaseWrite = typeof cardPurchaseBatch.$inferInsert;

export class PostgresCardRepository implements CardRepository {
  private readonly db: Database;
  private readonly identity: AuthenticatedIdentity;
  private readonly diagnostics: RepositoryDiagnostics;
  private readonly config: Pick<ApplicationConfig, 'CARD_IMPORT_BATCH_SIZE' | 'CARD_IMPORT_PURCHASE_BATCH_SIZE'>;

  constructor(
    db: Database,
    identity: AuthenticatedIdentity,
    diagnostics: RepositoryDiagnostics,
    config: Pick<
      ApplicationConfig,
      'CARD_IMPORT_BATCH_SIZE' | 'CARD_IMPORT_PURCHASE_BATCH_SIZE'
    > = DEFAULT_IMPORT_POLICY,
  ) {
    this.db = db;
    this.identity = identity;
    this.diagnostics = diagnostics;
    this.config = config;
  }

  private get userId() {
    return this.identity.requireUserId();
  }

  /**
   * Returns one owned-card page and all game-scoped set choices from one
   * database snapshot. Set choices do not depend on the set filter or cursor.
   */
  async listCollection(
    options: CardsPaginationQuery & { game?: CardGame; setNames: string[] },
  ): Promise<CardCollection> {
    const { game, setNames, limit, cursor } = options;

    return this.db.transaction(
      async tx => {
        const ownership = and(eq(card.userId, this.userId), game != null ? eq(card.game, game) : undefined);
        const sets = await tx.selectDistinct({ name: card.setName }).from(card).where(ownership).orderBy(card.setName);

        const rows = await tx
          .select({
            ...getColumns(card),
            cursorCreatedAt: sql<string>`to_char(${card.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          })
          .from(card)
          .where(
            and(
              ownership,
              setNames.length > 0 ? inArray(card.setName, new Set(setNames).values().toArray()) : undefined,
              cursor != null
                ? sql`(${card.createdAt}, ${card.id}) < (${cursor.createdAt}::timestamp, ${cursor.id})`
                : undefined,
            ),
          )
          .orderBy(sql`${card.createdAt} desc nulls last`, sql`${card.id} desc nulls last`)
          .limit(limit + 1);

        const page = rows.slice(0, limit);

        const cards: CardWithPurchases[] = page.map(card => {
          const ownedCard = omit(card, 'cursorCreatedAt');

          return { ...ownedCard, purchaseBatches: [] };
        });

        const cardsById = new Map(cards.map(ownedCard => [ownedCard.id, ownedCard]));

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
                  cards.map(ownedCard => ownedCard.id),
                ),
              ),
            )
            .orderBy(cardPurchaseBatch.createdAt, cardPurchaseBatch.id);

          for (const batch of batches) {
            cardsById.get(batch.cardId)?.purchaseBatches.push(batch);
          }
        }

        const last = page.at(-1);

        return {
          cards,
          availableSetNames: sets.map(set => set.name),
          nextCursor:
            rows.length > limit && last != null
              ? encodeCardCursor({ createdAt: last.cursorCreatedAt, id: last.id })
              : null,
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
      throw new CardNotFound();
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

      await tx.insert(cardConditionQuantity).values(conditionQuantityRows(createdCard.id, values.purchases));

      const purchaseBatches = await tx
        .insert(cardPurchaseBatch)
        .values(values.purchases.map(batch => purchaseBatchFields(createdCard.id, batch)))
        .returning();

      return { ...createdCard, purchaseBatches };
    });
  }

  async importCards(inputs: ImportCard[]): Promise<ImportCardsResponse> {
    const started = performance.now();
    const uniqueInputs = new Map(inputs.map(input => [input.id, input]));
    const entries = uniqueInputs.values().toArray();
    const logger = this.diagnostics.cardsLogger;

    const progress: CardImportProgress = {
      stage: 'validated',
      lastCompletedStage: 'validated',
      transactionStatus: 'pending',
    };

    this.diagnostics.setImportProgress(progress);
    logger.info(
      {
        event: 'cards.import.validated',
        outcome: 'success',
        received_count: inputs.length,
        unique_count: entries.length,
      },
      'Validated cards for import.',
    );

    try {
      const response = await this.db.transaction(async tx => {
        let importedCount = 0;
        let updatedCount = 0;
        let skippedCount = inputs.length - entries.length;
        const batchSize = this.config.CARD_IMPORT_BATCH_SIZE;
        const purchaseBatchSize = this.config.CARD_IMPORT_PURCHASE_BATCH_SIZE;
        const batchCount = Math.ceil(entries.length / batchSize);
        const processedOwnedIds = new Set<string>();

        progress.stage = 'lock_acquisition';
        const lockStarted = performance.now();
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'cards.import:' + this.userId}, 0))`);
        progress.lastCompletedStage = 'lock_acquired';
        logger.info(
          { event: 'cards.import.lock_acquired', outcome: 'success', duration_ms: performance.now() - lockStarted },
          'Acquired the owned-card import lock.',
        );

        progress.stage = 'ownership_resolution';
        const sourceIds = entries.map(input => input.id);

        const lockedCards = await tx
          .select()
          .from(card)
          .where(
            and(
              eq(card.userId, this.userId),
              sql`(${card.id} = any(${sql.param(sourceIds)}::text[]) or ${card.importSourceId} = any(${sql.param(sourceIds)}::text[]))`,
            ),
          )
          .orderBy(card.id)
          .for('update');

        for (let offset = 0; offset < entries.length; offset += batchSize) {
          const batchStarted = performance.now();
          const chunk = entries.slice(offset, offset + batchSize);
          const chunkIds = new Set(chunk.map(input => input.id));
          const batchIndex = Math.floor(offset / batchSize) + 1;
          progress.stage = 'ownership_resolution';

          const owned = lockedCards.filter(
            row => chunkIds.has(row.id) || (row.importSourceId != null && chunkIds.has(row.importSourceId)),
          );

          const ownedById = new Map(owned.map(row => [row.id, row]));

          const ownedBySource = new Map(
            owned.flatMap(row => (row.importSourceId == null ? [] : [[row.importSourceId, row] as const])),
          );

          const previousPurchases =
            owned.length === 0
              ? []
              : await tx
                  .select(getColumns(cardPurchaseBatch))
                  .from(cardPurchaseBatch)
                  .innerJoin(card, eq(card.id, cardPurchaseBatch.cardId))
                  .where(
                    and(
                      eq(card.userId, this.userId),
                      inArray(
                        card.id,
                        owned.map(row => row.id),
                      ),
                    ),
                  );

          const purchasesByCard = Map.groupBy(previousPurchases, purchase => purchase.cardId);
          const candidates = chunk.filter(input => !ownedById.has(input.id) && !ownedBySource.has(input.id));
          progress.lastCompletedStage = 'ownership_resolved';
          logger.info(
            {
              event: 'cards.import.ownership_resolved',
              outcome: 'success',
              batch_index: batchIndex,
              batch_count: batchCount,
              owned_count: owned.length,
              new_count: candidates.length,
            },
            'Resolved card ownership for the import batch.',
          );

          progress.stage = 'batch_preparation';

          const created =
            candidates.length === 0
              ? []
              : await tx
                  .insert(card)
                  .values(
                    candidates.map(input => ({
                      ...cardFields(input),
                      id: crypto.randomUUID(),
                      userId: this.userId,
                      importSourceId: input.id,
                      createdAt: new Date(input.created_at),
                      updatedAt: new Date(input.updated_at),
                    })),
                  )
                  .returning();

          const createdBySource = new Map(
            created.flatMap(row => (row.importSourceId == null ? [] : [[row.importSourceId, row] as const])),
          );

          const purchases: (typeof cardPurchaseBatch.$inferInsert)[] = [];
          const quantities: (typeof cardConditionQuantity.$inferInsert)[] = [];
          let batchUpdatedCount = 0;
          let batchSkippedCount = 0;

          for (const input of chunk) {
            const existing = ownedById.get(input.id) ?? ownedBySource.get(input.id);
            const target = existing ?? createdBySource.get(input.id);
            assert(target, 'Imported card must have an owned target');
            const previous = purchasesByCard.get(target.id) ?? [];
            const previousIds = new Set(previous.map(purchase => purchase.id));

            if (existing != null && (processedOwnedIds.has(target.id) || importMatches(existing, previous, input))) {
              batchSkippedCount += 1;
              continue;
            }

            processedOwnedIds.add(target.id);

            if (existing != null) {
              await tx
                .update(card)
                .set({
                  ...cardFields(input),
                  createdAt: new Date(input.created_at),
                  updatedAt: new Date(input.updated_at),
                  ...pricingLinkFields(existing, input),
                })
                .where(and(eq(card.id, target.id), eq(card.userId, this.userId)));

              const retainedIds = input.purchases.flatMap(purchase =>
                previousIds.has(purchase.id) ? [purchase.id] : [],
              );

              await clearReplacedPurchases(tx, target.id, retainedIds);
              batchUpdatedCount += 1;
            }

            purchases.push(
              ...input.purchases.map(purchase => ({
                ...purchaseBatchFields(target.id, purchase),
                id: previousIds.has(purchase.id) ? purchase.id : crypto.randomUUID(),
                automaticPriceDate: purchase.automatic_price_date,
              })),
            );
            quantities.push(...conditionQuantityRows(target.id, input.purchases));
          }

          for (let index = 0; index < purchases.length; index += purchaseBatchSize) {
            await upsertPurchases(tx, purchases.slice(index, index + purchaseBatchSize));
          }

          if (quantities.length > 0) {
            await tx.insert(cardConditionQuantity).values(quantities);
          }

          importedCount += created.length;
          updatedCount += batchUpdatedCount;
          skippedCount += batchSkippedCount;
          progress.lastCompletedStage = 'batch_prepared';
          logger.info(
            {
              event: 'cards.import.batch_prepared',
              outcome: 'success',
              batch_index: batchIndex,
              batch_count: batchCount,
              result_count: created.length,
              updated_count: batchUpdatedCount,
              skipped_count: batchSkippedCount,
              purchase_count: purchases.length,
              duration_ms: performance.now() - batchStarted,
              transaction_status: 'pending',
            },
            'Prepared import batch writes; the transaction has not committed yet.',
          );
        }

        progress.stage = 'commit';

        return { imported_count: importedCount, updated_count: updatedCount, skipped_count: skippedCount };
      });

      progress.stage = 'completed';
      progress.lastCompletedStage = 'completed';
      progress.transactionStatus = 'committed';
      logger.info(
        {
          event: 'cards.import',
          outcome: 'success',
          result_count: response.imported_count,
          updated_count: response.updated_count,
          skipped_count: response.skipped_count,
          duration_ms: performance.now() - started,
          transaction_status: 'committed',
        },
        'Committed the owned-card import.',
      );

      return response;
    } catch (error) {
      progress.transactionStatus = 'rolled_back';
      throw error;
    }
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
        throw new CardNotFound();
      }

      const [updatedCard] = await tx
        .update(card)
        .set({
          ...cardFields(values),
          updatedAt: new Date(),
          ...pricingLinkFields(ownedCard, values),
        })
        .where(and(eq(card.id, cardId), eq(card.userId, this.userId)))
        .returning();

      if (updatedCard == null) {
        return undefined;
      }

      const retainedIds = values.purchases.flatMap(batch => (batch.id == null ? [] : [batch.id]));
      await clearReplacedPurchases(tx, cardId, retainedIds);
      await tx.insert(cardConditionQuantity).values(conditionQuantityRows(cardId, values.purchases));

      const purchases = values.purchases.map(batch => {
        const previous = batch.id != null ? previousById.get(batch.id) : undefined;

        const unchangedPrice =
          previous?.purchasePrice === (batch.purchase_price != null ? decimalScale(batch.purchase_price) : null) &&
          previous?.currency === batch.currency;

        return {
          ...purchaseBatchFields(cardId, batch),
          automaticPriceDate: unchangedPrice ? previous?.automaticPriceDate : null,
        };
      });

      const purchaseBatches = await upsertPurchases(tx, purchases).returning();

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
          batch.purchasePrice = row.purchasePrice;
          batch.currency = row.currency;
          batch.automaticPriceDate = row.automaticPriceDate;
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

/** Both callers hold an owned-card row lock before replacing its purchases. */
async function clearReplacedPurchases(tx: Transaction, cardId: string, retainedIds: string[]): Promise<void> {
  await tx.delete(cardConditionQuantity).where(eq(cardConditionQuantity.cardId, cardId));
  await tx
    .delete(cardPurchaseBatch)
    .where(
      and(
        eq(cardPurchaseBatch.cardId, cardId),
        retainedIds.length > 0 ? notInArray(cardPurchaseBatch.id, retainedIds) : undefined,
      ),
    );
}

function upsertPurchases(tx: Transaction, purchases: PurchaseWrite[]) {
  return tx
    .insert(cardPurchaseBatch)
    .values(purchases)
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
    });
}

function conditionQuantityRows(cardId: string, purchases: UpsertCard['purchases']) {
  return purchaseQuantities(purchases).map(quantity => ({ cardId, ...quantity }));
}

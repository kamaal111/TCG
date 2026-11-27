import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { omit } from '@kamaalio/kamaal/objects';
import type { CardImportProgress } from '@tcg/http/progress';
import { and, eq, getColumns, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';

import { cardListChoices, cardListPredicates } from './card-list-filters.ts';
import { PostgresCardMetadataRepository } from './card-metadata.ts';
import { placeCardInBinder } from './collection-placement.ts';
import {
  bumpCollections,
  clearPlacements,
  collectionMembership,
  lockCollections,
  membershipFilter,
  reconcilePlacements,
} from './collection-transactions.ts';
import type { OwnedCardPriceResponse } from '../../card-pricing/schemas/responses.ts';
import { CARD_GAME_MAP } from '../../card-pricing/types.ts';
import { conditionValue } from '../../card-pricing/utils/conditions.ts';
import { CardNotFound, InvalidCatalogPrinting } from '../../cards/exceptions.ts';
import {
  pricingLinkFields,
  decimalScale,
  cardFields,
  purchaseBatchFields,
  importMatches,
  sameCardIdentity,
} from '../../cards/policies.ts';
import type { CardRepository, ResolvedCSVCard } from '../../cards/repository.ts';
import type { ImportCard, UpdateCard } from '../../cards/schemas/payloads.ts';
import type { DeleteCardsResponse, ImportCardsResponse } from '../../cards/schemas/responses.ts';
import type { CardWithPurchases, CardCollection, CatalogPrinting } from '../../cards/types.ts';
import { encodeCardCursor } from '../../cards/utils/pagination.ts';
import { marketPurchaseAmount } from '../../cards/utils/purchase-price.ts';
import { purchaseQuantities } from '../../cards/utils/quantities.ts';
import { DEFAULT_COLLECTION_POLICY, DEFAULT_IMPORT_POLICY, type ApplicationConfig } from '../../config.ts';
import type { Database } from '../../db/index.ts';
import { card, cardMetadata, cardConditionQuantity, cardPurchaseBatch } from '../../db/schema/cards.ts';
import { cursorPage } from '../../utils/pagination.ts';
import type { AuthenticatedIdentity, RepositoryDiagnostics } from '../contracts.ts';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type PurchaseWrite = typeof cardPurchaseBatch.$inferInsert;

type CardPolicy = Pick<
  ApplicationConfig,
  'CARD_IMPORT_BATCH_SIZE' | 'CARD_IMPORT_PURCHASE_BATCH_SIZE' | 'COLLECTION_MAX_PAGES'
>;

export const DEFAULT_CARD_POLICY = {
  ...DEFAULT_IMPORT_POLICY,
  COLLECTION_MAX_PAGES: DEFAULT_COLLECTION_POLICY.COLLECTION_MAX_PAGES,
};

export class PostgresCardRepository implements CardRepository {
  private readonly db: Database;
  private readonly metadata: PostgresCardMetadataRepository;
  private readonly identity: AuthenticatedIdentity;
  private readonly diagnostics: RepositoryDiagnostics;
  private readonly config: CardPolicy;

  constructor(db: Database, identity: AuthenticatedIdentity, diagnostics: RepositoryDiagnostics, config: CardPolicy) {
    this.db = db;
    this.metadata = new PostgresCardMetadataRepository(db, identity);
    this.identity = identity;
    this.diagnostics = diagnostics;
    this.config = config;
  }

  private get userId() {
    return this.identity.requireUserId();
  }

  async listSetOwnership(game: typeof card.$inferSelect.game) {
    return await this.db
      .selectDistinct({
        pricingCardId: card.pricingCardId,
        pricingSource: card.pricingSource,
        setName: card.setName,
        cardNumber: card.cardNumber,
      })
      .from(card)
      .where(
        and(
          eq(card.userId, this.userId),
          eq(card.game, game),
          sql`EXISTS (SELECT 1 FROM ${cardConditionQuantity}
          WHERE ${cardConditionQuantity.cardId} = ${card.id} AND ${cardConditionQuantity.quantity} > 0)`,
        ),
      );
  }

  /**
   * Returns one owned-card page and all game-scoped set choices from one
   * database snapshot. Set choices do not depend on the set filter or cursor.
   */
  async listCollection(options: Parameters<CardRepository['listCollection']>[0]): Promise<CardCollection> {
    const { limit, cursor } = options;

    const filters = cardListPredicates(
      {
        game: card.game,
        setName: card.setName,
        illustrator: cardMetadata.illustrator,
        name: card.name,
        englishSearchAlias: cardMetadata.englishSearchAlias,
        cardNumber: card.cardNumber,
      },
      options,
    );

    const result = await this.db.transaction(
      async tx => {
        const selectedCollection =
          options.collection_id != null
            ? await collectionMembership(tx, this.identity, options.collection_id)
            : undefined;

        const ownership = and(
          eq(card.userId, this.userId),
          filters.game,
          selectedCollection !== undefined ? membershipFilter(selectedCollection) : undefined,
        );

        const sets = await tx
          .selectDistinct({ name: card.setName })
          .from(card)
          .where(and(ownership, filters.setChoice))
          .orderBy(card.setName);

        const metadataIdentity = and(
          eq(cardMetadata.game, card.game),
          eq(cardMetadata.pricingSource, card.pricingSource),
          eq(cardMetadata.pricingCardId, card.pricingCardId),
        );

        const ownedIdentities = tx
          .selectDistinct({ game: card.game, pricingSource: card.pricingSource, pricingCardId: card.pricingCardId })
          .from(card)
          .where(and(ownership, eq(card.game, CARD_GAME_MAP.POKEMON), isNotNull(card.pricingCardId)))
          .as('owned_identities');

        const illustratorRows = await tx
          .selectDistinct({ name: cardMetadata.illustrator })
          .from(ownedIdentities)
          .innerJoin(
            cardMetadata,
            and(
              eq(cardMetadata.game, ownedIdentities.game),
              eq(cardMetadata.pricingSource, ownedIdentities.pricingSource),
              eq(cardMetadata.pricingCardId, ownedIdentities.pricingCardId),
            ),
          )
          .where(filters.illustratorChoice(cardMetadata.game))
          .orderBy(cardMetadata.illustrator);

        const rows = await tx
          .select({
            ...getColumns(card),
            illustrator: cardMetadata.illustrator,
            englishSearchAlias: cardMetadata.englishSearchAlias,
            cursorCreatedAt: sql<string>`to_char(${card.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          })
          .from(card)
          .leftJoin(cardMetadata, metadataIdentity)
          .where(
            and(
              ownership,
              filters.matches,
              cursor != null
                ? sql`(${card.createdAt}, ${card.id}) < (${cursor.createdAt}::timestamp, ${cursor.id})`
                : undefined,
            ),
          )
          .orderBy(sql`${card.createdAt} desc nulls last`, sql`${card.id} desc nulls last`)
          .limit(limit + 1);

        const { page, nextCursor } = cursorPage(rows, limit, row => {
          return encodeCardCursor({ createdAt: row.cursorCreatedAt, id: row.id });
        });

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

        return {
          cards,
          ...cardListChoices(sets, illustratorRows),
          nextCursor,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );

    return options.backfillEnglishAliases
      ? { ...result, cards: await this.metadata.backfillEnglishSearchAliases(result.cards) }
      : result;
  }

  /**
   * Gets a card when it is owned by the current session user.
   *
   * @param cardId Card identifier.
   * @returns The card with its purchases, or undefined when absent.
   */
  async get(cardId: string): Promise<CardWithPurchases | undefined> {
    const [found] = await this.getMany([cardId]);

    return found;
  }

  async getMany(cardIds: string[]): Promise<CardWithPurchases[]> {
    const cards = await this.db.query.card.findMany({
      where: { id: { in: cardIds }, userId: this.userId },
      with: {
        purchaseBatches: { orderBy: { createdAt: 'asc', id: 'asc' } },
        metadata: { columns: { illustrator: true, englishSearchAlias: true } },
      },
    });

    return cards.map(({ metadata, ...owned }) => ({
      ...owned,
      illustrator: metadata?.illustrator,
      englishSearchAlias: metadata?.englishSearchAlias,
    }));
  }

  async getArtworkOrigins(cardIds: string[]) {
    const cards = await this.db.query.card.findMany({
      where: { id: { in: cardIds }, userId: this.userId },
      columns: { id: true },
      with: { cachedPrices: { columns: { prices: true }, orderBy: { pricedOn: 'desc' }, limit: 1 } },
    });

    return cards.map(({ id, cachedPrices: [cached] }) => ({ id, origin: cached?.prices.image ?? undefined }));
  }

  /**
   * Creates a card and its purchases for the current session user.
   *
   * @param values Card fields and purchases to persist.
   * @returns The created card with its purchases.
   */
  create(values: UpdateCard, { illustrator, ...identity }: CatalogPrinting): Promise<CardWithPurchases> {
    if (values.purchases.some(batch => batch.id != null)) {
      throw new CardNotFound();
    }

    return this.db.transaction(async tx => {
      await lockCollections(tx, this.identity);
      const collectionId = await collectionMembership(tx, this.identity, values.collection_id);

      const [createdCard] = await tx
        .insert(card)
        .values({
          userId: this.userId,
          collectionId,
          ...identity,
          notes: values.notes ?? null,
        })
        .returning();

      assert(createdCard, 'Card insert did not return a row');

      await tx.insert(cardConditionQuantity).values(conditionQuantityRows(createdCard.id, values.purchases));

      const purchaseBatches = await tx
        .insert(cardPurchaseBatch)
        .values(values.purchases.map(batch => purchaseBatchFields(createdCard.id, batch)))
        .returning();

      await placeCardInBinder({
        tx,
        identity: this.identity,
        collectionId,
        cardId: createdCard.id,
        quantity: values.purchases.reduce((total, purchase) => total + purchase.quantity, 0),
        maximumPages: this.config.COLLECTION_MAX_PAGES,
      });
      await bumpCollections(tx, this.identity, [collectionId]);

      return { ...createdCard, illustrator, purchaseBatches };
    });
  }

  importCards(inputs: ResolvedCSVCard[]): Promise<ImportCardsResponse> {
    return this.writeImportedCards(inputs);
  }

  restoreCards(inputs: ImportCard[], transaction: Transaction): Promise<ImportCardsResponse> {
    return this.writeImportedCards(inputs, transaction);
  }

  private async writeImportedCards(
    inputs: readonly (ImportCard | ResolvedCSVCard)[],
    transaction?: Transaction,
  ): Promise<ImportCardsResponse> {
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
      const run =
        transaction == null
          ? this.db.transaction.bind(this.db)
          : async (action: (tx: Transaction) => Promise<ImportCardsResponse>) => action(transaction);

      const response = await run(async tx => {
        let adjustments = 0;
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
              sql`(${card.id} = any(${sql.param(sourceIds)}::uuid[]) or ${card.importSourceId} = any(${sql.param(sourceIds)}::uuid[]))`,
            ),
          )
          .orderBy(card.id)
          .for('update');

        const ownedById = new Map(lockedCards.map(row => [row.id, row]));

        const ownedBySource = new Map(
          lockedCards.flatMap(row => (row.importSourceId == null ? [] : [[row.importSourceId, row] as const])),
        );

        const conflicts = inputs.flatMap(input => {
          if (!('printing' in input)) {
            return [];
          }

          const existing = ownedById.get(input.id) ?? ownedBySource.get(input.id);
          const printing = input.printing;

          const agrees =
            existing == null ||
            (sameCardIdentity(existing, printing) &&
              (existing.pricingCardId == null ||
                (existing.pricingCardId === printing.pricingCardId &&
                  existing.pricingSource === printing.pricingSource)));

          return agrees ? [] : [['cards', input.sourceIndex, 'priced_card_id']];
        });

        if (conflicts.length > 0) {
          throw new InvalidCatalogPrinting(conflicts, 'conflict');
        }

        for (let offset = 0; offset < entries.length; offset += batchSize) {
          const batchStarted = performance.now();
          const chunk = entries.slice(offset, offset + batchSize);
          const chunkIds = new Set(chunk.map(input => input.id));
          const batchIndex = Math.floor(offset / batchSize) + 1;
          progress.stage = 'ownership_resolution';

          const owned = lockedCards.filter(
            row => chunkIds.has(row.id) || (row.importSourceId != null && chunkIds.has(row.importSourceId)),
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
          const reconciliations: { cardId: string; total: number }[] = [];
          const changedCollections = new Set<string | null>();
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
              const importedFields = cardFields(input);

              const fields =
                'printing' in input
                  ? { notes: input.notes ?? null }
                  : {
                      ...importedFields,
                      ...pricingLinkFields(existing, importedFields),
                      createdAt: new Date(input.created_at),
                    };

              await tx
                .update(card)
                .set({
                  ...fields,
                  updatedAt: new Date(input.updated_at),
                })
                .where(and(eq(card.id, target.id), eq(card.userId, this.userId)));

              const retainedIds = input.purchases.flatMap(purchase => {
                return previousIds.has(purchase.id) ? [purchase.id] : [];
              });

              await clearReplacedPurchases(tx, target.id, retainedIds);
              reconciliations.push({
                cardId: target.id,
                total: input.purchases.reduce((sum, p) => sum + p.quantity, 0),
              });
              changedCollections.add(existing.collectionId);
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

          adjustments += await reconcilePlacements(tx, this.identity, reconciliations);
          await bumpCollections(tx, this.identity, [...changedCollections]);

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

        return {
          imported_count: importedCount,
          updated_count: updatedCount,
          skipped_count: skippedCount,
          allocation_adjustments: adjustments > 0 ? adjustments : undefined,
        };
      });

      if (transaction != null) {
        return response;
      }

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
  update(cardId: string, values: UpdateCard): Promise<CardWithPurchases | undefined> {
    return this.db.transaction(async tx => {
      await lockCollections(tx, this.identity);

      const [ownedCard] = await tx
        .select()
        .from(card)
        .where(and(eq(card.id, cardId), eq(card.userId, this.userId)))
        .for('update');

      if (ownedCard == null) {
        return undefined;
      }

      const collectionId =
        values.collection_id === undefined
          ? ownedCard.collectionId
          : await collectionMembership(tx, this.identity, values.collection_id);

      if (collectionId !== ownedCard.collectionId) {
        await clearPlacements(tx, this.identity, [cardId]);
        await bumpCollections(tx, this.identity, [ownedCard.collectionId]);
      }

      const previousBatches = await tx.select().from(cardPurchaseBatch).where(eq(cardPurchaseBatch.cardId, cardId));
      const previousById = new Map(previousBatches.map(batch => [batch.id, batch]));

      if (values.purchases.some(batch => batch.id != null && !previousById.has(batch.id))) {
        throw new CardNotFound();
      }

      const [updatedCard] = await tx
        .update(card)
        .set({
          notes: values.notes ?? null,
          collectionId,
          updatedAt: new Date(),
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

        const fields = purchaseBatchFields(cardId, batch);

        if (previous == null) {
          return fields;
        }

        return { ...fields, automaticPriceDate: unchangedPrice ? previous.automaticPriceDate : null };
      });

      const purchaseBatches = await upsertPurchases(tx, purchases).returning();
      const quantity = values.purchases.reduce((total, purchase) => total + purchase.quantity, 0);

      const allocationAdjustments = await reconcilePlacements(tx, this.identity, [
        {
          cardId,
          total: quantity,
        },
      ]);

      if (collectionId !== ownedCard.collectionId) {
        await placeCardInBinder({
          tx,
          identity: this.identity,
          collectionId,
          cardId,
          quantity,
          maximumPages: this.config.COLLECTION_MAX_PAGES,
        });
      }

      await bumpCollections(tx, this.identity, [collectionId]);

      return {
        ...updatedCard,
        purchaseBatches,
        allocationAdjustments: allocationAdjustments > 0 ? allocationAdjustments : undefined,
      };
    });
  }

  /** Fills missing costs with this request's daily average in one conditional write. */
  async backfillPurchasePrices(cards: CardWithPurchases[], prices: readonly OwnedCardPriceResponse[]): Promise<void> {
    const priceById = new Map(prices.map(price => [price.card_id, price]));

    const candidates = cards.flatMap(owned => {
      const price = priceById.get(owned.id)?.priced_card;

      if (price == null) {
        return [];
      }

      return owned.purchaseBatches.flatMap(batch => {
        const value = batch.purchasePrice == null ? conditionValue(price.condition_values, batch.condition) : undefined;
        const amount = value != null ? marketPurchaseAmount(value.amount) : null;

        return amount == null || value == null
          ? []
          : [
              {
                card_id: owned.id,
                game: owned.game,
                name: owned.name,
                card_number: owned.cardNumber,
                batch_id: batch.id,
                condition: batch.condition,
                amount,
                currency: value.currency,
                priced_on: price.priced_on.slice(0, 10),
              },
            ];
      });
    });

    if (candidates.length === 0) {
      return;
    }

    const input = this.db.$with('purchase_price_input').as(
      this.db
        .select({
          cardId: sql<string>`input.card_id::uuid`.as('card_id'),
          game: sql<string>`input.game`.as('game'),
          name: sql<string>`input.name`.as('name'),
          cardNumber: sql<string>`input.card_number`.as('card_number'),
          batchId: sql<string>`input.batch_id::uuid`.as('batch_id'),
          condition: sql<string>`input.condition`.as('condition'),
          amount: sql<string>`input.amount`.as('amount'),
          currency: sql<string>`input.currency`.as('currency'),
          pricedOn: sql<string>`input.priced_on`.as('priced_on'),
        })
        .from(
          sql`jsonb_to_recordset(${JSON.stringify(candidates)}::jsonb)
            as input(card_id text, game text, name text, card_number text, batch_id text,
                     condition text, amount text, currency text, priced_on text)`,
        ),
    );

    const eligible = this.db.$with('eligible_purchase_prices').as(
      this.db
        .select({
          cardId: input.cardId,
          batchId: input.batchId,
          condition: input.condition,
          amount: input.amount,
          currency: input.currency,
          pricedOn: input.pricedOn,
        })
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
      .where(
        and(
          eq(cardPurchaseBatch.cardId, eligible.cardId),
          eq(cardPurchaseBatch.id, eligible.batchId),
          eq(sql`${cardPurchaseBatch.condition}::text`, eligible.condition),
          isNull(cardPurchaseBatch.purchasePrice),
        ),
      )
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

    const deleted = await this.db.transaction(async tx => {
      await lockCollections(tx, this.identity);

      const owned = await tx
        .select()
        .from(card)
        .where(and(inArray(card.id, ids), eq(card.userId, this.userId)));

      await bumpCollections(
        tx,
        this.identity,
        owned.map(c => c.collectionId),
      );

      return tx
        .delete(card)
        .where(and(inArray(card.id, ids), eq(card.userId, this.userId)))
        .returning({ id: card.id });
    });

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

function conditionQuantityRows(cardId: string, purchases: UpdateCard['purchases']) {
  return purchaseQuantities(purchases).map(quantity => ({ cardId, ...quantity }));
}

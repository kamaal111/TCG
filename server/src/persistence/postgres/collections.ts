import crypto from 'node:crypto';

import { and, eq, inArray, or, sql, sum, count } from 'drizzle-orm';
import type { z } from 'zod';

import type { PostgresCardRepository } from './cards.ts';
import { COLLECTION_BATCH_SIZE } from './collection-batches.ts';
import { exportCollectionBackup } from './collection-export.ts';
import { runCollectionOperation } from './collection-operation.ts';
import {
  bumpCollections,
  clearPlacements,
  ensureUnfiled,
  lockCollections,
  type Transaction,
} from './collection-transactions.ts';
import { importMatches } from '../../cards/policies.ts';
import type { BackupWriter } from '../../collections/backup-stream.ts';
import { CollectionNotFound, LayoutConflict } from '../../collections/exceptions.ts';
import type { CollectionRepository } from '../../collections/repository.ts';
import type { SaveLayout, UpdateCollectionSchema } from '../../collections/schemas/payloads.ts';
import type { Collection, CollectionBackup } from '../../collections/schemas/responses.ts';
import type { CollectionPolicy } from '../../collections/types.ts';
import type { Database } from '../../db/index.ts';
import { binderPage, binderSlot, cardCollection, card, cardPurchaseBatch } from '../../db/schema/cards.ts';
import type { AuthenticatedIdentity, RepositoryDiagnostics } from '../contracts.ts';

interface CollectionRepositoryOptions {
  db: Database;
  identity: AuthenticatedIdentity;
  diagnostics: RepositoryDiagnostics;
  policy: CollectionPolicy;
  cardRepository: PostgresCardRepository;
}

export class PostgresCollectionRepository implements CollectionRepository {
  private readonly db: Database;
  private readonly identity: AuthenticatedIdentity;
  private readonly diagnostics: RepositoryDiagnostics;
  private readonly policy: CollectionPolicy;
  private readonly cardRepository: PostgresCardRepository;

  constructor({ db, identity, diagnostics, policy, cardRepository }: CollectionRepositoryOptions) {
    this.db = db;
    this.identity = identity;
    this.diagnostics = diagnostics;
    this.policy = policy;
    this.cardRepository = cardRepository;
  }

  private async transaction<T>(action: (tx: Transaction) => Promise<T>, admitted = false) {
    if (admitted) {
      return runCollectionOperation({ db: this.db, identity: this.identity, policy: this.policy, action });
    }

    return this.db.transaction(async tx => {
      await lockCollections(tx, this.identity);
      await ensureUnfiled(tx, this.identity);

      return action(tx);
    });
  }

  private async owned(tx: Transaction, id: string) {
    const [owned] = await tx
      .select()
      .from(cardCollection)
      .where(and(eq(cardCollection.id, id), eq(cardCollection.userId, this.identity.requireUserId())));

    if (owned == null) {
      throw new CollectionNotFound();
    }

    return owned;
  }

  private async read(tx: Transaction, id: string): Promise<Collection> {
    const collection = await this.owned(tx, id);

    const pages = await tx
      .select()
      .from(binderPage)
      .where(eq(binderPage.collectionId, collection.id))
      .orderBy(binderPage.position);

    const slots =
      pages.length === 0
        ? []
        : await tx
            .select()
            .from(binderSlot)
            .where(
              inArray(
                binderSlot.pageId,
                pages.map(page => page.id),
              ),
            )
            .orderBy(binderSlot.row, binderSlot.column);

    const byPage = Map.groupBy(slots, slot => slot.pageId);

    return {
      id: collection.id,
      name: collection.name,
      is_unfiled: collection.isUnfiled,
      columns: collection.columns,
      rows: collection.rows,
      revision: collection.revision,
      pages: pages.map(page => ({
        id: page.id,
        slots: (byPage.get(page.id) ?? []).map(slot => ({
          row: slot.row,
          column: slot.column,
          card_id: slot.cardId,
          quantity: slot.quantity,
        })),
      })),
    };
  }

  private readTransaction<T>(action: (tx: Transaction) => Promise<T>) {
    return this.db.transaction(action, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  list() {
    return this.db.transaction(async tx => {
      await ensureUnfiled(tx, this.identity);

      return tx
        .select({
          id: cardCollection.id,
          name: cardCollection.name,
          is_unfiled: cardCollection.isUnfiled,
          revision: cardCollection.revision,
        })
        .from(cardCollection)
        .where(eq(cardCollection.userId, this.identity.requireUserId()))
        .orderBy(sql`${cardCollection.isUnfiled} desc`, cardCollection.name, cardCollection.id);
    });
  }

  get(id: string) {
    return this.readTransaction(tx => this.read(tx, id));
  }

  create(name: string) {
    return this.transaction(async tx => {
      const id = crypto.randomUUID();
      await tx.insert(cardCollection).values({ id, userId: this.identity.requireUserId(), name });

      return this.read(tx, id);
    });
  }

  update(id: string, values: z.infer<typeof UpdateCollectionSchema>) {
    return this.transaction(async tx => {
      const owned = await this.owned(tx, id);

      if (owned.revision !== values.revision) {
        throw new LayoutConflict();
      }

      if (owned.isUnfiled) {
        throw new LayoutConflict('Unfiled cannot be renamed.');
      }

      await tx
        .update(cardCollection)
        .set({ name: values.name, revision: owned.revision + 1 })
        .where(eq(cardCollection.id, owned.id));

      return this.read(tx, id);
    });
  }

  private async writeLayout(tx: Transaction, owned: typeof cardCollection.$inferSelect, values: SaveLayout) {
    const id = owned.id;

    if (owned.revision !== values.revision) {
      throw new LayoutConflict();
    }

    const ids = [...new Set(values.pages.flatMap(p => p.slots.map(s => s.card_id)))];

    const cards =
      ids.length === 0
        ? []
        : await tx
            .select({ id: card.id, quantity: sum(cardPurchaseBatch.quantity) })
            .from(card)
            .leftJoin(cardPurchaseBatch, eq(cardPurchaseBatch.cardId, card.id))
            .where(
              and(
                eq(card.userId, this.identity.requireUserId()),
                inArray(card.id, ids),
                owned.isUnfiled ? sql`${card.collectionId} is null` : eq(card.collectionId, id),
              ),
            )
            .groupBy(card.id);

    const totals = new Map(cards.map(c => [c.id, Number(c.quantity ?? 0)]));
    const allocated = new Map<string, number>();

    for (const page of values.pages) {
      for (const slot of page.slots) {
        const amount = (allocated.get(slot.card_id) ?? 0) + slot.quantity;

        if (!totals.has(slot.card_id)) {
          throw new CollectionNotFound();
        }

        if (amount > (totals.get(slot.card_id) ?? 0)) {
          throw new LayoutConflict('Not enough unplaced copies are available.');
        }

        allocated.set(slot.card_id, amount);
      }
    }

    await tx.delete(binderPage).where(eq(binderPage.collectionId, id));

    const pages = values.pages.map((page, position) => ({ id: page.id, collectionId: id, position }));

    for (let start = 0; start < pages.length; start += COLLECTION_BATCH_SIZE) {
      const batch = pages.slice(start, start + COLLECTION_BATCH_SIZE);
      const inserted = await tx.insert(binderPage).values(batch).onConflictDoNothing().returning({ id: binderPage.id });

      if (inserted.length !== batch.length) {
        throw new CollectionNotFound();
      }
    }

    const slots = values.pages.flatMap(p =>
      p.slots.map(s => ({ pageId: p.id, row: s.row, column: s.column, cardId: s.card_id, quantity: s.quantity })),
    );

    for (let start = 0; start < slots.length; start += COLLECTION_BATCH_SIZE) {
      await tx.insert(binderSlot).values(slots.slice(start, start + COLLECTION_BATCH_SIZE));
    }

    await tx
      .update(cardCollection)
      .set({ columns: values.columns, rows: values.rows, revision: owned.revision + 1 })
      .where(eq(cardCollection.id, id));
  }

  save(id: string, values: SaveLayout) {
    return this.transaction(async tx => {
      await this.writeLayout(tx, await this.owned(tx, id), values);

      return this.read(tx, id);
    }, true);
  }

  delete(id: string) {
    return this.transaction(async tx => {
      const owned = await this.owned(tx, id);

      if (owned.isUnfiled) {
        throw new LayoutConflict('Unfiled cannot be deleted.');
      }

      await tx
        .update(card)
        .set({ collectionId: null })
        .where(and(eq(card.userId, this.identity.requireUserId()), eq(card.collectionId, id)));
      await tx.delete(cardCollection).where(eq(cardCollection.id, id));
      await bumpCollections(tx, this.identity, [null]);
    });
  }

  page(id: string, pageId: string) {
    return this.readTransaction(async tx => {
      const [page] = await tx
        .select({ id: binderPage.id })
        .from(binderPage)
        .innerJoin(cardCollection, eq(binderPage.collectionId, cardCollection.id))
        .where(
          and(
            eq(binderPage.id, pageId),
            eq(cardCollection.id, id),
            eq(cardCollection.userId, this.identity.requireUserId()),
          ),
        );

      if (page == null) {
        throw new CollectionNotFound();
      }

      const slots = await tx
        .selectDistinct({ cardId: binderSlot.cardId })
        .from(binderSlot)
        .where(eq(binderSlot.pageId, page.id));

      const cards =
        slots.length === 0
          ? []
          : await tx.query.card.findMany({
              where: { userId: this.identity.requireUserId(), id: { in: slots.map(slot => slot.cardId) } },
              with: { purchaseBatches: true },
            });

      return { cards };
    });
  }

  exportTo(writer: BackupWriter, ids?: string[]) {
    return this.transaction(tx => exportCollectionBackup({ tx, identity: this.identity, writer, ids }), true);
  }

  preview(backup: CollectionBackup) {
    return this.transaction(async tx => {
      await ensureUnfiled(tx, this.identity);

      const collectionSources = backup.collections.map(collection => collection.id);

      const ownedCollections = await tx
        .select()
        .from(cardCollection)
        .where(
          and(
            eq(cardCollection.userId, this.identity.requireUserId()),
            or(
              eq(cardCollection.isUnfiled, true),
              inArray(cardCollection.id, collectionSources),
              inArray(cardCollection.importSourceId, collectionSources),
            ),
          ),
        );

      const sources = backup.cards.map(c => c.id);

      const ownedCards =
        sources.length === 0
          ? []
          : await tx
              .select()
              .from(card)
              .where(
                and(
                  eq(card.userId, this.identity.requireUserId()),
                  or(inArray(card.id, sources), inArray(card.importSourceId, sources)),
                ),
              );

      const cardsBySource = firstMatchIndex(ownedCards);
      const incomingByOwnedId = Map.groupBy(backup.cards, c => cardsBySource.get(c.id)?.id);

      const matchedIds = [
        ...new Set(
          backup.cards.flatMap(source => {
            const owned = cardsBySource.get(source.id);

            return owned != null ? [owned.id] : [];
          }),
        ),
      ];

      const purchases = [];

      for (let start = 0; start < matchedIds.length; start += COLLECTION_BATCH_SIZE) {
        const ids = matchedIds.slice(start, start + COLLECTION_BATCH_SIZE);

        const counts = await tx
          .select({ id: card.id, sourceId: card.importSourceId, quantity: count(cardPurchaseBatch.id) })
          .from(card)
          .leftJoin(cardPurchaseBatch, eq(cardPurchaseBatch.cardId, card.id))
          .where(and(eq(card.userId, this.identity.requireUserId()), inArray(card.id, ids)))
          .groupBy(card.id);

        const comparableIds = counts.flatMap(c => {
          const inputs = incomingByOwnedId.get(c.id) ?? [];

          return inputs.some(input => input.purchases.length === c.quantity) ? [c.id] : [];
        });

        if (comparableIds.length > 0) {
          purchases.push(
            ...(await tx.select().from(cardPurchaseBatch).where(inArray(cardPurchaseBatch.cardId, comparableIds))),
          );
        }
      }

      const purchasesByCard = Map.groupBy(purchases, p => p.cardId);

      let newCollections = 0;
      let updatedCollections = 0;
      let newCards = 0;
      let updatedCards = 0;
      let movedCards = 0;
      const mapping = new Map<string, string | null>();
      const collectionsBySource = firstMatchIndex(ownedCollections);
      const unfiled = ownedCollections.find(c => c.isUnfiled);

      for (const source of backup.collections) {
        const owned = source.is_unfiled ? unfiled : collectionsBySource.get(source.id);

        if (owned == null) {
          newCollections += 1;
        } else {
          updatedCollections += 1;
        }

        mapping.set(source.id, source.is_unfiled ? null : (owned?.id ?? source.id));
      }

      for (const source of backup.cards) {
        const owned = cardsBySource.get(source.id);

        if (owned == null) {
          newCards += 1;
        } else {
          if (!importMatches(owned, purchasesByCard.get(owned.id) ?? [], source)) {
            updatedCards += 1;
          }

          if (owned.collectionId !== mapping.get(source.collection_id)) {
            movedCards += 1;
          }
        }
      }

      return {
        new_collection_count: newCollections,
        updated_collection_count: updatedCollections,
        new_card_count: newCards,
        updated_card_count: updatedCards,
        moved_card_count: movedCards,
      };
    }, true);
  }

  async import(backup: CollectionBackup) {
    try {
      const result = await this.transaction(async tx => {
        const unfiled = await ensureUnfiled(tx, this.identity);
        const mapping = new Map<string, string>();

        const collectionSources = backup.collections.map(source => source.id);

        const existingCollections =
          collectionSources.length === 0
            ? []
            : await tx
                .select()
                .from(cardCollection)
                .where(
                  and(
                    eq(cardCollection.userId, this.identity.requireUserId()),
                    or(
                      inArray(cardCollection.id, collectionSources),
                      inArray(cardCollection.importSourceId, collectionSources),
                    ),
                  ),
                );

        const collectionsBySource = firstMatchIndex(existingCollections);
        const created: (typeof cardCollection.$inferInsert)[] = [];

        for (const source of backup.collections) {
          const existing = source.is_unfiled ? unfiled : collectionsBySource.get(source.id);
          const id = existing?.id ?? crypto.randomUUID();

          if (existing == null) {
            created.push({ id, userId: this.identity.requireUserId(), importSourceId: source.id, name: source.name });
          } else if (existing.isUnfiled && !source.is_unfiled) {
            throw new LayoutConflict('A named collection cannot replace Unfiled.');
          }

          mapping.set(source.id, id);
        }

        for (let start = 0; start < created.length; start += COLLECTION_BATCH_SIZE) {
          await tx.insert(cardCollection).values(created.slice(start, start + COLLECTION_BATCH_SIZE));
        }

        const result = await this.cardRepository.importCards(backup.cards, tx);

        const sources = backup.cards.map(c => c.id);

        const cards =
          sources.length === 0
            ? []
            : await tx
                .select()
                .from(card)
                .where(
                  and(
                    eq(card.userId, this.identity.requireUserId()),
                    or(inArray(card.id, sources), inArray(card.importSourceId, sources)),
                  ),
                );

        const cardMapping = new Map<string, string>();

        for (const c of cards) {
          cardMapping.set(c.id, c.id);

          if (c.importSourceId != null) {
            cardMapping.set(c.importSourceId, c.id);
          }
        }

        const cardsById = new Map(cards.map(c => [c.id, c]));

        const memberships = new Map<string | null, string[]>();
        const previousCollections = new Set<string | null>();

        for (const input of backup.cards) {
          const id = cardMapping.get(input.id);
          const target = mapping.get(input.collection_id);

          if (id == null || target == null) {
            throw new CollectionNotFound();
          }

          const destination = target === unfiled.id ? null : target;
          const ids = memberships.get(destination) ?? [];
          ids.push(id);
          memberships.set(destination, ids);
          previousCollections.add(cardsById.get(id)?.collectionId ?? null);
        }

        await clearPlacements(tx, this.identity, [...cardsById.keys()]);

        for (const [collectionId, ids] of memberships) {
          for (let start = 0; start < ids.length; start += COLLECTION_BATCH_SIZE) {
            await tx
              .update(card)
              .set({ collectionId })
              .where(
                and(
                  inArray(card.id, ids.slice(start, start + COLLECTION_BATCH_SIZE)),
                  eq(card.userId, this.identity.requireUserId()),
                ),
              );
          }
        }

        await bumpCollections(tx, this.identity, [...previousCollections]);

        const names = backup.collections.map(source => {
          const id = mapping.get(source.id);

          return sql`when ${id}::uuid then ${source.is_unfiled ? 'Unfiled' : source.name}`;
        });

        if (names.length > 0) {
          await tx
            .update(cardCollection)
            .set({ name: sql`case ${cardCollection.id} ${sql.join(names, sql` `)} else ${cardCollection.name} end` })
            .where(
              and(
                eq(cardCollection.userId, this.identity.requireUserId()),
                inArray(cardCollection.id, [...mapping.values()]),
              ),
            );
        }

        const currentCollections = await tx
          .select()
          .from(cardCollection)
          .where(
            and(
              eq(cardCollection.userId, this.identity.requireUserId()),
              inArray(cardCollection.id, [...mapping.values()]),
            ),
          );

        const currentById = new Map(currentCollections.map(collection => [collection.id, collection]));

        for (const source of backup.collections) {
          const id = mapping.get(source.id);
          const current = id != null ? currentById.get(id) : undefined;

          if (current == null) {
            throw new CollectionNotFound();
          }

          const pages = source.pages.map(p => ({
            id: crypto.randomUUID(),
            slots: p.slots.map(s => {
              const cardId = cardMapping.get(s.card_id);

              if (cardId == null) {
                throw new CollectionNotFound();
              }

              return { ...s, card_id: cardId };
            }),
          }));

          await this.writeLayout(tx, current, {
            revision: current.revision,
            columns: source.columns,
            rows: source.rows,
            pages,
          });
        }

        return { ...result, collection_count: mapping.size };
      }, true);

      this.diagnostics.setImportProgress({
        stage: 'completed',
        lastCompletedStage: 'completed',
        transactionStatus: 'committed',
      });

      return result;
    } catch (error) {
      this.diagnostics.setImportProgress({
        stage: 'commit',
        lastCompletedStage: 'batch_prepared',
        transactionStatus: 'rolled_back',
      });
      throw error;
    }
  }
}

function firstMatchIndex<T extends { id: string; importSourceId: string | null }>(entries: readonly T[]) {
  const index = new Map<string, T>();

  for (const entry of entries) {
    for (const key of [entry.id, entry.importSourceId]) {
      if (key != null && !index.has(key)) {
        index.set(key, entry);
      }
    }
  }

  return index;
}

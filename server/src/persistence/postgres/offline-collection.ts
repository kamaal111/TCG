import { serializeCollectionLayout } from './collection-layout.ts';
import type { OfflineCollectionIDs, OfflineCollectionRepository } from '../../cards/offline-collection-repository.ts';
import type { Database } from '../../db/index.ts';
import type { AuthenticatedIdentity } from '../contracts.ts';

type OfflineQueryDatabase = Pick<Database, 'query'>;

export class PostgresOfflineCollectionRepository implements OfflineCollectionRepository {
  private readonly db: Database;
  private readonly identity: AuthenticatedIdentity;

  constructor(db: Database, identity: AuthenticatedIdentity) {
    this.db = db;
    this.identity = identity;
  }

  async read(ids: OfflineCollectionIDs | undefined) {
    if (ids?.collections.length === 0) {
      return { cards: await this.readCards(this.db, ids.cards), collections: [] };
    }

    if (ids?.cards.length === 0) {
      return { cards: [], collections: await this.readCollections(this.db, ids.collections) };
    }

    return this.db.transaction(
      async tx => ({
        cards: await this.readCards(tx, ids?.cards),
        collections: await this.readCollections(tx, ids?.collections),
      }),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  private async readCards(db: OfflineQueryDatabase, ids: string[] | undefined) {
    if (ids?.length === 0) {
      return [];
    }

    const cards = await db.query.card.findMany({
      where: { userId: this.identity.requireUserId(), id: ids != null ? { in: ids } : undefined },
      with: {
        metadata: { columns: { illustrator: true } },
        purchaseBatches: {
          columns: { createdAt: false, updatedAt: false },
          orderBy: { createdAt: 'asc', id: 'asc' },
        },
        cachedPrices: { orderBy: { pricedOn: 'desc' }, limit: 1 },
      },
    });

    return cards.map(({ metadata, cachedPrices, ...owned }) => ({
      owned: { ...owned, illustrator: metadata?.illustrator },
      price: cachedPrices[0],
    }));
  }

  private async readCollections(db: OfflineQueryDatabase, ids: string[] | undefined) {
    const owner = this.identity.requireUserId();

    const collections = await db.query.cardCollection.findMany({
      where: { userId: owner, id: ids != null ? { in: ids } : undefined },
      with: {
        pages: {
          orderBy: { position: 'asc' },
          with: {
            slots: {
              where: { card: { userId: owner } },
              orderBy: { row: 'asc', column: 'asc' },
            },
          },
        },
      },
    });

    return collections.map(collection => {
      const slotsByPage = new Map(collection.pages.map(page => [page.id, page.slots]));

      return serializeCollectionLayout(collection, collection.pages, slotsByPage);
    });
  }
}

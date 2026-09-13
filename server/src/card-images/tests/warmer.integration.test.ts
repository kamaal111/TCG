import { ok } from 'neverthrow';

import { createDatabaseOnlyContext } from '../../context.ts';
import { CARD_IMAGE_STATUSES, cardImage } from '../../db/schema/card-images.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { CardImageMaterializer } from '../materializer.ts';
import type { CardImageOriginClient, CardImageOriginResult } from '../origin-client.ts';
import { CardImageRepository } from '../repository.ts';
import { CardImageWarmer } from '../warmer.ts';

describe('CardImageWarmer', () => {
  integrationTest('claims no more images than it has capacity to work on', async ({ db, storageClient }) => {
    const origin = new GatedImageOriginClient();
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));

    const warmer = new CardImageWarmer({
      repository,
      materializer: new CardImageMaterializer({
        repository,
        storageClient,
        imageOriginClient: origin,
      }),
      concurrency: 1,
    });

    await db.insert(cardImage).values(
      ['a', 'b', 'c'].map(prefix => ({
        imageKey: prefix.repeat(64),
        originUrl: `https://images.example.com/${prefix}.png`,
        storageKey: `card-images/${prefix}`,
      })),
    );

    warmer.notifyRegistered(3);
    await origin.firstCallStarted;
    const duringFirstFetch = await db.select().from(cardImage);

    origin.release();
    await warmer.idle();
    const afterDraining = await db.select().from(cardImage);

    expect(duringFirstFetch.filter(row => row.status === CARD_IMAGE_STATUSES.FETCHING)).toHaveLength(1);
    expect(duringFirstFetch.filter(row => row.status === CARD_IMAGE_STATUSES.PENDING)).toHaveLength(2);
    expect(afterDraining.every(row => row.status === CARD_IMAGE_STATUSES.READY)).toBe(true);
    expect(origin.callCount).toBe(3);
  });

  integrationTest('is idle when there is nothing to claim', async ({ db, storageClient }) => {
    const origin = new GatedImageOriginClient();
    const repository = new CardImageRepository(createDatabaseOnlyContext(db));

    const warmer = new CardImageWarmer({
      repository,
      materializer: new CardImageMaterializer({
        repository,
        storageClient,
        imageOriginClient: origin,
      }),
    });

    warmer.notifyRegistered(1);
    await warmer.idle();

    expect(origin.callCount).toBe(0);
  });
});

/** An origin client that holds every fetch until released, then lets all callers through. */
class GatedImageOriginClient implements CardImageOriginClient {
  callCount = 0;
  readonly firstCallStarted: Promise<void>;

  private released = false;
  private readonly waiters: (() => void)[] = [];
  private announceFirstCall: () => void = () => undefined;

  constructor() {
    this.firstCallStarted = new Promise(resolve => {
      this.announceFirstCall = resolve;
    });
  }

  async fetchImage(): Promise<CardImageOriginResult> {
    this.callCount += 1;
    this.announceFirstCall();

    if (!this.released) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }

    return ok({ body: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
  }

  release(): void {
    this.released = true;

    for (const resolve of this.waiters.splice(0)) {
      resolve();
    }
  }
}

import { integrationTest } from './fixtures.ts';
import { imageRecord } from './utils.ts';
import { cardImage } from '../../db/schema/card-images.ts';
import { CARD_IMAGE_STATUSES } from '../types.ts';

describe('CardImageWarmer', () => {
  integrationTest(
    'claims no more images than it has capacity to work on',
    async ({ db, imageOrigin: origin, createImageWarmer }) => {
      const warmer = createImageWarmer({ concurrency: 1 });

      await db.insert(cardImage).values(
        ['a', 'b', 'c'].map(prefix =>
          imageRecord({
            imageKey: prefix.repeat(64),
          }),
        ),
      );

      warmer.notifyRegistered(3);
      await origin.started;
      const duringFirstFetch = await db.select().from(cardImage);

      origin.release();
      await warmer.idle();
      const afterDraining = await db.select().from(cardImage);

      expect(duringFirstFetch.filter(row => row.status === CARD_IMAGE_STATUSES.FETCHING)).toHaveLength(1);
      expect(duringFirstFetch.filter(row => row.status === CARD_IMAGE_STATUSES.PENDING)).toHaveLength(2);
      expect(afterDraining.every(row => row.status === CARD_IMAGE_STATUSES.READY)).toBe(true);
      expect(origin.callCount).toBe(3);
    },
  );

  integrationTest('is idle when there is nothing to claim', async ({ imageOrigin: origin, createImageWarmer }) => {
    const warmer = createImageWarmer();

    warmer.notifyRegistered(1);
    await warmer.idle();

    expect(origin.callCount).toBe(0);
  });
});

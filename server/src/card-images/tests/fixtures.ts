import { GatedImageOriginClient, imageRecord } from './utils.ts';
import { cardImage } from '../../db/schema/card-images.ts';
import { PostgresCardImageRepository } from '../../persistence/postgres/card-images.ts';
import { CardImageWarmer } from '../../runtime/node/warmer.ts';
import { integrationTest as baseIntegrationTest } from '../../tests/fixtures.ts';
import { CardImageMaterializer } from '../materializer.ts';

export const integrationTest = baseIntegrationTest
  .extend('imageRepository', ({ db }) => new PostgresCardImageRepository(db))
  .extend('imageOrigin', ({ task: _task }, { onCleanup }) => {
    const origin = new GatedImageOriginClient();
    onCleanup(() => origin.release());

    return origin;
  })
  .extend(
    'imageMaterializer',
    ({ imageRepository, storageClient, imageOrigin }) =>
      new CardImageMaterializer({ repository: imageRepository, storageClient, imageOriginClient: imageOrigin }),
  )
  .extend('createImage', ({ db }) => async (overrides: Partial<typeof cardImage.$inferInsert> = {}) => {
    await db.insert(cardImage).values(imageRecord(overrides));
  })
  .extend(
    'createImageWarmer',
    ({ imageRepository, imageMaterializer, imageOrigin }, { onCleanup }) =>
      (options: Pick<ConstructorParameters<typeof CardImageWarmer>[0], 'concurrency'> = {}) => {
        const warmer = new CardImageWarmer({
          repository: imageRepository,
          materializer: imageMaterializer,
          ...options,
        });

        onCleanup(async () => {
          imageOrigin.release();
          warmer.stop();
          await warmer.idle();
        });

        return warmer;
      },
  );

import { processImagesLogger } from './card-images/logging.ts';
import { CardImageMaterializer } from './card-images/materializer.ts';
import { HttpCardImageOriginClient } from './card-images/origin-client.ts';
import { CardImageRepository } from './card-images/repository.ts';
import { CardImageWarmer } from './card-images/warmer.ts';
import db from './db/index.ts';
import { createObjectStorageClient } from './storage/factory.ts';

const repository = new CardImageRepository({ db });
const materializer = new CardImageMaterializer({
  repository,
  storageClient: createObjectStorageClient(),
  imageOriginClient: new HttpCardImageOriginClient(),
});
const worker = new CardImageWarmer({ repository, materializer });

worker.start({ keepProcessAlive: true });
processImagesLogger().info({ event: 'images.worker.started', outcome: 'success' }, 'Started the card image worker.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    worker.stop();
    processImagesLogger().info(
      { event: 'images.worker.stopped', outcome: 'success' },
      'Stopped the card image worker.',
    );
    process.exit(0);
  });
}

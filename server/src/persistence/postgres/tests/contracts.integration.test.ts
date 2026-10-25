import type { CardsLogFields } from '../../../cards/logging.ts';
import env from '../../../env.ts';
import { getProcessLogger } from '../../../logging/index.ts';
import NodeApp from '../../../runtime/node/app.ts';
import { definePersistenceContracts } from '../../../tests/persistence-contracts.ts';
import { createTestObjectStorage } from '../../../tests/storage.ts';
import { createTestDatabase, createTestUser } from '../../../tests/utils.ts';
import { createPostgresPersistence } from '../index.ts';

definePersistenceContracts('PostgreSQL and S3', async () => {
  const database = await createTestDatabase('./drizzle');
  const storage = await createTestObjectStorage();
  const persistence = createPostgresPersistence(database.db, env.PRICING_LOCK_TIMEOUT_MS);
  const app = new NodeApp({ db: database.db, storageClient: storage }).app;

  return {
    images: persistence.cardImageRepository,
    forex: persistence.forexRepository,
    coordinator: persistence.pricingCoordinator,
    storage,
    createOwner: async () => {
      const user = await createTestUser(app, database.db);

      const repositories = persistence.forRequest(
        { requireUserId: () => user.userId },
        {
          cardsLogger: getProcessLogger<CardsLogFields>(),
          setImportProgress: () => {},
        },
      );

      return { cards: repositories.cardRepository, preferences: repositories.userPreferencesRepository };
    },
    cleanup: database.cleanup,
  };
});

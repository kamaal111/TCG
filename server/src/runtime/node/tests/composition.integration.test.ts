import { ok } from 'neverthrow';

import { createApp } from '../../../app.ts';
import { processImagesLogger } from '../../../card-images/logging.ts';
import { CardImageProcessor } from '../../../card-images/warmer.ts';
import { ApplicationConfigSchema } from '../../../config.ts';
import { integrationTest } from '../../../tests/fixtures.ts';
import { createTestUser } from '../../../tests/utils.ts';
import { createNodeApplication } from '../app.ts';

integrationTest(
  'constructs the shared app without querying persistence or installing Node lifecycle',
  async ({ db, storageClient }) => {
    const composed = createNodeApplication({ db, storageClient });
    const query = vi.spyOn(db.$client, 'query');
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const signal = vi.spyOn(process, 'on');
    const app = createApp(composed.dependencies);
    expect(query).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    expect(signal).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect((await app.request('/health/ping')).status).toBe(200);
    await composed.dispose();
  },
);

integrationTest(
  'supports application configuration without PostgreSQL or S3 credentials',
  async ({ db, storageClient }) => {
    const config = ApplicationConfigSchema.parse({ BETTER_AUTH_URL: 'https://tcg.example.com', MODE: 'TEST' });
    const composed = createNodeApplication({ db, storageClient, config });
    const response = await composed.app.request('/spec.json');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ servers: [{ url: 'https://tcg.example.com' }] });
    await composed.dispose();
  },
);

integrationTest(
  'reads normalized authentication sessions and persisted verification keys through its adapter',
  async ({ db, storageClient }) => {
    const composed = createNodeApplication({ db, storageClient });
    const user = await createTestUser(composed.app, db);
    const auth = composed.dependencies.auth;

    const session = await auth.api.getSession({
      headers: new Headers({ Authorization: `Bearer ${user.sessionToken}` }),
    });

    expect(session?.user.id).toBe(user.userId);
    expect(session?.user.createdAt).toBeInstanceOf(Date);
    expect(session?.session.expiresAt).toBeInstanceOf(Date);
    const keys = await auth.verificationKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys[0]?.publicKey).toEqual(expect.any(String));
    await composed.dispose();
  },
);

integrationTest('processes queued image work without installing a polling scheduler', async ({ db, storageClient }) => {
  const composed = createNodeApplication({
    db,
    storageClient,
    imageOriginClient: {
      fetchImage: async () => ok({ body: new Uint8Array([1, 2, 3]), contentType: 'image/png' }),
    },
  });

  const dependencies = composed.dependencies;
  const repository = dependencies.persistence.cardImageRepository;
  await repository.registerMany([
    { imageKey: 'processor-image', originUrl: 'https://example.com/image.png', storageKey: 'cards/processor.png' },
  ]);
  const timer = vi.spyOn(globalThis, 'setTimeout');

  const processor = new CardImageProcessor({
    repository,
    materializer: dependencies.cardImageMaterializer,
    concurrency: 1,
    logger: processImagesLogger(),
  });

  expect(timer).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  await processor.processPending();
  expect(await repository.getByImageKey('processor-image')).toMatchObject({
    status: 'ready',
    attemptCount: 0,
    contentLength: 3,
  });
  expect((await storageClient.get('cards/processor.png'))._unsafeUnwrap().body).toEqual(new Uint8Array([1, 2, 3]));
  await composed.dispose();
});

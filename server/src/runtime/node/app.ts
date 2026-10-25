import { type ServerType, serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { showRoutes } from 'hono/dev';

import { initializeNodeLogging } from './logging.ts';
import { CardImageWarmer } from './warmer.ts';
import { createApp } from '../../app.ts';
import { CardImageMaterializer } from '../../card-images/materializer.ts';
import { HttpCardImageOriginClient } from '../../card-images/origin-client.ts';
import { createPricingClient } from '../../card-pricing/scrydex/factory.ts';
import { ApplicationConfigSchema } from '../../config.ts';
import { ONE_SECOND_IN_MS } from '../../constants/time.ts';
import type { HonoEnvironment, InjectedContext } from '../../context.ts';
import { createDatabase, type Database } from '../../db/index.ts';
import env from '../../env.ts';
import { InternalServerError } from '../../exceptions/index.ts';
import { EcbForexClient } from '../../forex/client.ts';
import { serverLogger } from '../../logging/server.ts';
import { OPENAPI_YAML_SPEC_PATH } from '../../open-api.ts';
import { createAuth } from '../../persistence/postgres/auth-client.ts';
import { createPostgresPersistence } from '../../persistence/postgres/index.ts';
import { S3ObjectStorageClient } from '../../storage/s3-client.ts';

const SIGNALS_TO_TERMINATE_ON: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

type AppOverrides = Partial<Omit<InjectedContext, 'persistence' | 'auth' | 'cardImageWarmer'>> & {
  db?: Database;
  cardImageWarmer?: CardImageWarmer;
};

interface Lifecycle {
  start(): void;
  stop(): void;
}

class NodeApp {
  readonly app: Hono<HonoEnvironment>;

  private server: ServerType | undefined;
  private readonly lifecycle: Lifecycle | undefined;
  private readonly disposeResources: () => Promise<void>;

  constructor(overrides: AppOverrides = {}) {
    const created = createNodeApplication(overrides);
    this.app = created.app;
    this.lifecycle = created.lifecycle;
    this.disposeResources = created.dispose;
  }

  close = async () => {
    this.lifecycle?.stop();
    await this.disposeResources();
  };

  serve = () => {
    assertObjectStorageIsConfigured();
    this.start();
    this.cleanupUnShotdown();
  };

  generateSpec = async () => {
    const response = await this.app.request(new URL(OPENAPI_YAML_SPEC_PATH, env.BASE_URL), {
      headers: { Accept: 'text/yaml' },
    });

    return response.text();
  };

  private start = () => {
    const app = this.app;

    if (app == null) {
      return;
    }

    if (env.DEBUG) {
      showRoutes(app, { verbose: false });
    }

    this.lifecycle?.start();
    this.server = serve({ fetch: app.fetch, port: env.PORT }, info => {
      serverLogger().info({ event: 'server.started', port: info.port, outcome: 'success' }, 'Started the HTTP server.');
    });
  };

  private cleanupUnShotdown = () => {
    const server = this.server;

    if (server == null) {
      return;
    }

    for (const signal of SIGNALS_TO_TERMINATE_ON) {
      process.on(signal, () => {
        this.lifecycle?.stop();
        const logger = serverLogger();
        logger.info({ event: 'server.shutdown.started', signal, outcome: 'success' }, 'Shutting the HTTP server down.');

        server.close(async () => {
          await this.close();
          logger.info({ event: 'server.shutdown.completed', outcome: 'success' }, 'Shut the HTTP server down.');
          process.exit(0);
        });

        setTimeout(() => {
          logger.warn(
            { event: 'server.shutdown.forced', outcome: 'failure', error_code: 'SHUTDOWN_TIMEOUT' },
            'Forced the HTTP server down after it did not close in time.',
          );
          process.exit(1);
        }, 10 * ONE_SECOND_IN_MS);
      });
    }
  };
}

function assertObjectStorageIsConfigured() {
  const missing = (['OBJECT_STORAGE_ACCESS_KEY_ID', 'OBJECT_STORAGE_SECRET_ACCESS_KEY'] as const).filter(
    key => env[key] == null,
  );

  if (missing.length === 0) {
    return;
  }

  throw new InternalServerError(undefined, {
    diagnosticMessage:
      `Missing object storage configuration: ${missing.join(', ')}. ` +
      'Run `just start-services` and copy the object storage settings from .env.example.',
  });
}

function storageOptions() {
  return {
    accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    bucket: env.OBJECT_STORAGE_BUCKET,
    region: env.OBJECT_STORAGE_REGION,
    endpoint: env.OBJECT_STORAGE_ENDPOINT,
    forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
    requestTimeoutMs: env.OBJECT_STORAGE_REQUEST_TIMEOUT_MS,
    maxAttempts: env.OBJECT_STORAGE_MAX_ATTEMPTS,
  };
}

export function createNodeApplication(overrides: AppOverrides = {}) {
  initializeNodeLogging();
  const config = overrides.config ?? ApplicationConfigSchema.parse(env);

  const db =
    overrides.db ??
    createDatabase({
      url: env.DATABASE_URL,
      debug: env.DEBUG,
      connectionTimeoutMs: config.DATABASE_CONNECTION_TIMEOUT_MS,
    });

  const auth = createAuth(db, config, env.BETTER_AUTH_SECRET);
  const persistence = createPostgresPersistence(db, config.PRICING_LOCK_TIMEOUT_MS, config);
  const forexClient = overrides.forexClient ?? new EcbForexClient();
  const pricingClient = overrides.pricingClient ?? createPricingClient(config);
  const storageClient = overrides.storageClient ?? new S3ObjectStorageClient(storageOptions());

  const imageOriginClient =
    overrides.imageOriginClient ??
    new HttpCardImageOriginClient({
      maxBytes: config.CARD_IMAGE_MAX_BYTES,
      requestTimeoutMs: config.CARD_IMAGE_REQUEST_TIMEOUT_MS,
    });

  const cardImageRepository = persistence.cardImageRepository;

  const cardImageMaterializer =
    overrides.cardImageMaterializer ??
    new CardImageMaterializer({
      config,
      repository: cardImageRepository,
      storageClient,
      imageOriginClient,
    });

  const cardImageWarmer =
    overrides.cardImageWarmer ??
    new CardImageWarmer({ repository: cardImageRepository, materializer: cardImageMaterializer }, config);

  const dependencies = {
    config,
    forexClient,
    persistence,
    auth,
    pricingClient,
    storageClient,
    imageOriginClient,
    cardImageMaterializer,
    cardImageWarmer,
  };

  const app = createApp(dependencies);

  const lifecycle: Lifecycle | undefined = config.CARD_IMAGE_WORKER_ENABLED
    ? { start: () => cardImageWarmer.start(), stop: () => cardImageWarmer.stop() }
    : undefined;

  return {
    app,
    dependencies,
    lifecycle,
    dispose: async () => {
      await cardImageWarmer.idle();

      if (overrides.db == null) {
        await db.$client.end();
      }
    },
  };
}

export default NodeApp;

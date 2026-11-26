import { type ServerType, serve } from '@hono/node-server';
import { InternalServerError } from '@tcg/http/exceptions';
import { registerNodeServerShutdown } from '@tcg/http/node-server-lifecycle';
import { serverLogger } from '@tcg/http/server-logging';
import type { Hono } from 'hono';
import { showRoutes } from 'hono/dev';

import { initializeNodeLogging } from './logging.ts';
import { CardImageWarmer } from './warmer.ts';
import { createApp } from '../../app.ts';
import { CardImageMaterializer } from '../../card-images/materializer.ts';
import { HttpCardImageOriginClient } from '../../card-images/origin-client.ts';
import { createPricingClient } from '../../card-pricing/scrydex/factory.ts';
import { RealScrydexClient } from '../../card-pricing/scrydex/real-client.ts';
import { PRICING_CLIENT_MODES } from '../../constants/common.ts';
import type { HonoEnvironment, InjectedContext } from '../../context.ts';
import { createDatabase, type Database } from '../../db/index.ts';
import env, { applicationConfig } from '../../env.ts';
import { EcbForexClient } from '../../forex/client.ts';
import { createAuth } from '../../persistence/postgres/auth-client.ts';
import { createPostgresPersistence } from '../../persistence/postgres/index.ts';
import { CARD_CATALOG_PATH, SQLiteCardCatalog } from '../../persistence/sqlite/card-catalog.ts';
import { createConfiguredObjectStorage } from '../../storage/config.ts';

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

  constructor(overrides: AppOverrides) {
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
    registerNodeServerShutdown({
      server: () => this.server,
      stop: () => this.lifecycle?.stop(),
      dispose: this.close,
    });
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

export function createNodeApplication(overrides: AppOverrides) {
  initializeNodeLogging();
  const config = overrides.config ?? applicationConfig;

  const db =
    overrides.db ??
    createDatabase({
      url: env.DATABASE_URL,
      debug: env.DEBUG,
      connectionTimeoutMs: config.DATABASE_CONNECTION_TIMEOUT_MS,
    });

  const auth = createAuth(db, config, env.BETTER_AUTH_SECRET);
  const persistence = createPostgresPersistence(db, config.PRICING_LOCK_TIMEOUT_MS, config);
  const forexClient = overrides.forexClient ?? new EcbForexClient({});
  const pricingClient = overrides.pricingClient ?? createPricingClient(config);

  const ownedCardCatalog =
    overrides.cardCatalog == null &&
    !config.IS_TEST &&
    config.SCRYDEX_CLIENT === PRICING_CLIENT_MODES.REAL &&
    pricingClient instanceof RealScrydexClient
      ? new SQLiteCardCatalog(CARD_CATALOG_PATH)
      : undefined;

  const cardCatalog = overrides.cardCatalog ?? ownedCardCatalog;

  const storageClient = overrides.storageClient ?? createConfiguredObjectStorage(env);

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
    cardCatalog,
    storageClient,
    imageOriginClient,
    cardImageMaterializer,
    cardImageWarmer,
  };

  const app = createApp(dependencies);

  const lifecycle: Lifecycle = {
    start: () => {
      if (config.CARD_IMAGE_WORKER_ENABLED) {
        cardImageWarmer.start({});
      }
    },
    stop: () => {
      cardImageWarmer.stop();
    },
  };

  return {
    app,
    dependencies,
    lifecycle,
    dispose: async () => {
      await cardImageWarmer.idle();

      ownedCardCatalog?.[Symbol.dispose]();

      await persistence.close();

      if (overrides.db == null) {
        await db.$client.end();
      }
    },
  };
}

export default NodeApp;

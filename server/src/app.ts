import { type ServerType, serve } from '@hono/node-server';
import { $ } from '@kamaalio/hono-standard-openapi';
import type { Hono } from 'hono';
import { showRoutes } from 'hono/dev';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';

import appApiRoute from './app-api/index.ts';
import { auth as authSingleton, createAuth } from './auth/better-auth.ts';
import cardImageAwareCompressionMiddleware from './card-images/compression-middleware.ts';
import { CardImageMaterializer } from './card-images/materializer.ts';
import { HttpCardImageOriginClient } from './card-images/origin-client.ts';
import { CardImageRepository } from './card-images/repository.ts';
import { CardImageWarmer } from './card-images/warmer.ts';
import { createPricingClient } from './card-pricing/scrydex/factory.ts';
import { APP_API_ROUTE_NAME, REQUEST_ID_HEADER_NAME } from './constants/common.ts';
import { ONE_SECOND_IN_MS } from './constants/time.ts';
import {
  createDatabaseOnlyContext,
  type HonoEnvironment,
  type InjectedContext,
  injectRequestContext,
} from './context.ts';
import dbSingleton from './db/index.ts';
import env from './env.ts';
import { handleServerError } from './exceptions/handler.ts';
import { NotFound } from './exceptions/index.ts';
import healthRoute, { HEALTH_ROUTE_NAME } from './health/index.ts';
import loggingMiddleware from './logging/middleware.ts';
import { serverLogger } from './logging/server.ts';
import { OPENAPI_YAML_SPEC_URL, openAPIRouterFactory, withOpenAPIDocumentation } from './open-api.ts';
import { createObjectStorageClient } from './storage/factory.ts';

const SIGNALS_TO_TERMINATE_ON: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

type Lifecycle = {
  start: () => void;
  stop: () => void;
};

class App {
  readonly app: Hono<HonoEnvironment>;

  private server: ServerType | undefined;
  private readonly lifecycle: Lifecycle | undefined;

  constructor(
    overrides: Partial<
      Pick<
        InjectedContext,
        'db' | 'pricingClient' | 'storageClient' | 'imageOriginClient' | 'cardImageMaterializer' | 'cardImageWarmer'
      >
    > = {},
  ) {
    const created = createApp(overrides);
    this.app = created.app;
    this.lifecycle = created.lifecycle;
  }

  serve = () => {
    this.start();
    this.cleanupUnShotdown();
  };

  generateSpec = async () => {
    const response = await this.app.request(OPENAPI_YAML_SPEC_URL, { headers: { Accept: 'text/yaml' } });
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

        server.close(() => {
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

function createApp(
  overrides: Partial<
    Pick<
      InjectedContext,
      'db' | 'pricingClient' | 'storageClient' | 'imageOriginClient' | 'cardImageMaterializer' | 'cardImageWarmer'
    >
  > = {},
) {
  const db = overrides.db ?? dbSingleton;
  const auth = overrides.db != null ? createAuth(db) : authSingleton;
  const pricingClient = overrides.pricingClient ?? createPricingClient();
  const storageClient = overrides.storageClient ?? createObjectStorageClient();
  const imageOriginClient = overrides.imageOriginClient ?? new HttpCardImageOriginClient();
  const cardImageRepository = new CardImageRepository(createDatabaseOnlyContext(db));
  const cardImageMaterializer =
    overrides.cardImageMaterializer ??
    new CardImageMaterializer({
      repository: cardImageRepository,
      storageClient,
      imageOriginClient,
    });
  const cardImageWarmer =
    overrides.cardImageWarmer ??
    new CardImageWarmer({ repository: cardImageRepository, materializer: cardImageMaterializer });

  const app = withOpenAPIDocumentation(
    $(
      openAPIRouterFactory()
        .onError(handleServerError())
        .use(requestId({ headerName: REQUEST_ID_HEADER_NAME }))
        .use(cardImageAwareCompressionMiddleware())
        .use(secureHeaders())
        .use(loggingMiddleware())
        .use(
          injectRequestContext({
            db,
            auth,
            pricingClient,
            storageClient,
            imageOriginClient,
            cardImageMaterializer,
            cardImageWarmer,
          }),
        )
        .route(HEALTH_ROUTE_NAME, healthRoute)
        .route(APP_API_ROUTE_NAME, appApiRoute),
    ),
  ).all('/*', c => new NotFound(c).getResponse());

  const lifecycle: Lifecycle | undefined = env.CARD_IMAGE_WORKER_ENABLED
    ? { start: () => cardImageWarmer.start(), stop: () => cardImageWarmer.stop() }
    : undefined;

  return { app, lifecycle };
}

export default App;

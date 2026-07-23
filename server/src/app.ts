import { type ServerType, serve } from '@hono/node-server';
import { $ } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { compress } from 'hono/compress';
import { showRoutes } from 'hono/dev';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';

import appApiRoute from './app-api/index.ts';
import { auth as authSingleton, createAuth } from './auth/better-auth.ts';
import { createPricingClient } from './card-pricing/scrydex/factory.ts';
import { APP_API_ROUTE_NAME, REQUEST_ID_HEADER_NAME } from './constants/common.ts';
import { type HonoEnvironment, type InjectedContext, injectRequestContext } from './context.ts';
import dbSingleton from './db/index.ts';
import env from './env.ts';
import { handleServerError } from './exceptions/handler.ts';
import { NotFound } from './exceptions/index.ts';
import healthRoute, { HEALTH_ROUTE_NAME } from './health/index.ts';
import { getComponentLogger, logInfo, logWarn } from './logging/index.ts';
import loggingMiddleware from './logging/middleware.ts';
import { OPENAPI_YAML_SPEC_URL, openAPIRouterFactory, withOpenAPIDocumentation } from './open-api.ts';

const SIGNALS_TO_TERMINATE_ON: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

const logger = getComponentLogger('server');

class App {
  readonly app: Hono<HonoEnvironment>;

  private server: ServerType | undefined;

  constructor(overrides: Partial<Pick<InjectedContext, 'db' | 'pricingClient'>> = {}) {
    this.app = createApp(overrides);
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

    this.server = serve({ fetch: app.fetch, port: env.PORT }, info => {
      logInfo(logger, {
        event: 'server.started',
        port: info.port,
        outcome: 'success',
      });
    });
  };

  private cleanupUnShotdown = () => {
    const server = this.server;
    if (server == null) {
      return;
    }

    for (const signal of SIGNALS_TO_TERMINATE_ON) {
      process.on(signal, () => {
        logInfo(logger, {
          event: 'server.shutdown.started',
          signal,
          outcome: 'success',
        });

        server.close(() => {
          logInfo(logger, {
            event: 'server.shutdown.completed',
            outcome: 'success',
          });
          process.exit(0);
        });

        setTimeout(() => {
          logWarn(logger, {
            event: 'server.shutdown.forced',
            outcome: 'failure',
          });
          process.exit(1);
        }, 10_000);
      });
    }
  };
}

function createApp(overrides: Partial<Pick<InjectedContext, 'db' | 'pricingClient'>> = {}) {
  const db = overrides.db ?? dbSingleton;
  const auth = overrides.db != null ? createAuth(db) : authSingleton;
  const pricingClient = overrides.pricingClient ?? createPricingClient();

  return withOpenAPIDocumentation(
    $(
      openAPIRouterFactory()
        .onError(handleServerError())
        .use(requestId({ headerName: REQUEST_ID_HEADER_NAME }))
        .use(compress())
        .use(secureHeaders())
        .use(loggingMiddleware())
        .use(injectRequestContext({ db, auth, pricingClient }))
        .route(HEALTH_ROUTE_NAME, healthRoute)
        .route(APP_API_ROUTE_NAME, appApiRoute),
    ),
  ).all('/*', c => new NotFound(c).getResponse());
}

export default App;

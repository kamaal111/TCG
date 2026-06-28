import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { requestId } from 'hono/request-id';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { showRoutes } from 'hono/dev';

import env from './env.ts';
import dbSingleton from './db/index.ts';
import { injectRequestContext, type HonoEnvironment, type InjectedContext } from './context.ts';
import { APP_API_ROUTE_NAME, REQUEST_ID_HEADER_NAME } from './constants/common.ts';
import loggingMiddleware from './logging/middleware.ts';
import { handleServerError } from './exceptions/handler.ts';
import { getComponentLogger, logInfo, logWarn } from './logging/index.ts';
import healthRoute, { HEALTH_ROUTE_NAME } from './health/index.ts';
import appApiRoute from './app-api/index.ts';
import { auth as authSingleton, createAuth } from './auth/better-auth.ts';

const SIGNALS_TO_TERMINATE_ON: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

const logger = getComponentLogger('server');

class App {
  private app: Hono<HonoEnvironment>;
  private server: ServerType | undefined;

  constructor() {
    this.app = new Hono();
  }

  serve = (overrides: Partial<Pick<InjectedContext, 'db'>> = {}) => {
    const db = overrides.db ?? dbSingleton;
    const auth = overrides.db != null ? createAuth(db) : authSingleton;
    this.registerMiddleware({ db, auth });
    this.registerHandlers();
    this.start();
    this.cleanupUnShotdown();
  };

  private start = () => {
    if (env.DEBUG) {
      showRoutes(this.app, { verbose: false });
    }

    this.server = serve({ fetch: this.app.fetch, port: env.PORT }, info => {
      logInfo(logger, {
        event: 'server.started',
        port: info.port,
        outcome: 'success',
      });
    });
  };

  private registerMiddleware = (overrides: InjectedContext) => {
    this.app
      .onError(handleServerError())
      .use(requestId({ headerName: REQUEST_ID_HEADER_NAME }))
      .use(compress())
      .use(secureHeaders())
      .use(loggingMiddleware())
      .use(injectRequestContext(overrides));
  };

  private registerHandlers() {
    this.app.route(HEALTH_ROUTE_NAME, healthRoute).route(APP_API_ROUTE_NAME, appApiRoute);
  }

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

export default App;

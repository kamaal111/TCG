import { $ } from '@kamaalio/hono-standard-openapi';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';

import { createAppApiRoute } from './app-api/index.ts';
import { createApplicationAuthModule } from './auth/module.ts';
import cardImageAwareCompressionMiddleware from './card-images/compression-middleware.ts';
import { APP_API_ROUTE_NAME, REQUEST_ID_HEADER_NAME } from './constants/common.ts';
import { type InjectedContext, injectRequestContext } from './context.ts';
import { handleServerError } from './exceptions/handler.ts';
import { NotFound } from './exceptions/index.ts';
import healthRoute, { HEALTH_ROUTE_NAME } from './health/index.ts';
import loggingMiddleware from './logging/middleware.ts';
import { openAPIRouterFactory, withOpenAPIDocumentation } from './open-api.ts';

export function createApp({
  config,
  forexClient,
  persistence,
  auth,
  pricingClient,
  storageClient,
  imageOriginClient,
  cardImageMaterializer,
  cardImageWarmer,
}: InjectedContext) {
  const authModule = createApplicationAuthModule(config);

  const app = withOpenAPIDocumentation(
    $(
      openAPIRouterFactory()
        .onError(handleServerError())
        .use(requestId({ headerName: REQUEST_ID_HEADER_NAME }))
        .use(cardImageAwareCompressionMiddleware())
        .use(secureHeaders())
        .use(async (c, next) => {
          c.set('config', config);
          c.set('authModule', authModule);
          await next();
        })
        .use(loggingMiddleware())
        .use(
          injectRequestContext({
            config,
            forexClient,
            persistence,
            auth,
            pricingClient,
            storageClient,
            imageOriginClient,
            cardImageMaterializer,
            cardImageWarmer,
          }),
        )
        .route(HEALTH_ROUTE_NAME, healthRoute)
        .route(APP_API_ROUTE_NAME, createAppApiRoute(authModule, config)),
    ),
    config.BASE_URL,
  ).all('/*', c => new NotFound(c).getResponse());

  return app;
}

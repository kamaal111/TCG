import { $ } from '@kamaalio/hono-standard-openapi';
import { REQUEST_ID_HEADER_NAME } from '@tcg/http/common';
import { handleServerError } from '@tcg/http/error-handler';
import { NotFound } from '@tcg/http/exceptions';
import { loggingMiddleware } from '@tcg/http/logging-middleware';
import { openAPIRouterFactory, withOpenAPIDocumentation } from '@tcg/http/open-api';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';

import { createAppRoutes } from './app-routes.ts';
import cardImageAwareCompressionMiddleware from './card-images/compression-middleware.ts';
import { type HonoEnvironment, type InjectedContext, injectRequestContext } from './context.ts';

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
  const { router, authModule } = createAppRoutes(config);

  const app = withOpenAPIDocumentation(
    $(
      openAPIRouterFactory<HonoEnvironment>()
        .onError(handleServerError())
        .use(requestId({ headerName: REQUEST_ID_HEADER_NAME }))
        .use(cardImageAwareCompressionMiddleware())
        .use(secureHeaders())
        .use(async (c, next) => {
          c.set('config', config);
          c.set('authModule', authModule);
          await next();
        })
        .use(loggingMiddleware<HonoEnvironment>())
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
        .route('/', router),
    ),
    config.BASE_URL,
  ).all('/*', c => new NotFound(c).getResponse());

  return app;
}

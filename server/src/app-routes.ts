import { openAPIRouterFactory } from '@tcg/http/open-api';

import { createAppApiRoute } from './app-api/index.ts';
import { createApplicationAuthModule } from './auth/module.ts';
import type { ApplicationConfig } from './config.ts';
import { APP_API_ROUTE_NAME } from './constants/common.ts';
import type { HonoEnvironment } from './context.ts';
import healthRoute, { HEALTH_ROUTE_NAME } from './health/index.ts';

export function createAppRoutes(config: ApplicationConfig) {
  const authModule = createApplicationAuthModule(config);

  const router = openAPIRouterFactory<HonoEnvironment>()
    .route(HEALTH_ROUTE_NAME, healthRoute)
    .route(APP_API_ROUTE_NAME, createAppApiRoute(authModule, config));

  return { router, authModule };
}

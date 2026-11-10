import { renderOpenAPIYaml } from '@tcg/http/open-api';

import { createAppRoutes } from '../src/app-routes.ts';
import { createApplicationConfig, DEFAULT_APPLICATION_CONFIG } from '../src/config.ts';

export function generateOpenAPISpec(): string {
  const config = createApplicationConfig({
    ...DEFAULT_APPLICATION_CONFIG,
    BETTER_AUTH_URL: 'http://localhost:8080',
  });

  const { router } = createAppRoutes(config);

  return renderOpenAPIYaml(router, config.BASE_URL);
}

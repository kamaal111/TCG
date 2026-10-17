import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import type { AuthRouteDeps } from '@kamaalio/kamaal-auth-hono';
import { every } from 'hono/combine';

import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { AUTH_OPENAPI_TAG } from '../constants.ts';
import type { AuthLocals } from '../hooks.ts';
import { preferencesLogger } from '../logging.ts';
import { CurrencyPreferencePayloadSchema } from '../schemas/payloads.ts';

export function createPreferencesRoutes(deps: AuthRouteDeps<AuthLocals, HonoEnvironment>) {
  return [createPreferencesRoute(deps, 'post'), createPreferencesRoute(deps, 'patch')];
}

function createPreferencesRoute(deps: AuthRouteDeps<AuthLocals, HonoEnvironment>, method: 'post' | 'patch') {
  const routeConfig = createRoute({
    method,
    path: '/preferences',
    tags: [AUTH_OPENAPI_TAG],
    summary: method === 'post' ? 'Initialize preferred currency' : 'Update preferred currency',
    middleware: [every(deps.requireSessionMiddleware)] as const,
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          [MIME_TYPES.JSON]: {
            schema: CurrencyPreferencePayloadSchema,
          },
        },
      },
    },
    responses: {
      [CONTENTFUL_STATUS_CODES.OK]: {
        description: 'Updated session',
        content: { [MIME_TYPES.JSON]: { schema: deps.schemas.SessionResponseSchema } },
      },
      [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: {
        description: 'Invalid preference',
        content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
      },
      [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: {
        description: 'Unauthenticated',
        content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
      },
    },
  });

  return defineOpenAPIRoute<HonoEnvironment, typeof routeConfig>({
    route: routeConfig,
    handler: async c => {
      const payload = c.req.valid('json');

      const repository = c.get('userPreferencesRepository');

      const preferred_currency =
        method === 'post'
          ? await repository.initializePreferredCurrency(payload.preferred_currency)
          : await repository.updatePreferredCurrency(payload.preferred_currency);

      const session = deps.getSession(c);

      preferencesLogger(c).info(
        {
          event: 'auth.preferences.completed',
          outcome: 'success',
          preference_action: method === 'post' ? 'initialize' : 'update',
          requested_currency: payload.preferred_currency,
          preferred_currency,
        },
        'Resolved the account currency preference.',
      );

      return c.json(
        {
          ...session,
          user: { ...session.user, preferred_currency },
        },
        { status: CONTENTFUL_STATUS_CODES.OK },
      );
    },
  });
}

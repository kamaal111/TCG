import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import type { AuthRouteDeps } from '@kamaalio/kamaal-auth-hono';
import { every } from 'hono/combine';

import { CONTENTFUL_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import type { HonoEnvironment } from '../../context.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { AUTH_OPENAPI_TAG } from '../constants.ts';
import type { AuthLocals } from '../hooks.ts';
import { UpdatePreferencesSchema } from '../schemas/payloads.ts';
import { SessionResponseSchema } from '../schemas/responses.ts';

export function createUpdatePreferencesRoute(deps: AuthRouteDeps<AuthLocals, HonoEnvironment>) {
  const routeConfig = createRoute({
    method: 'patch',
    path: '/preferences',
    tags: [AUTH_OPENAPI_TAG],
    summary: 'Update preferred currency',
    middleware: [every(deps.requireSessionMiddleware)] as const,
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          [MIME_TYPES.JSON]: {
            schema: UpdatePreferencesSchema,
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

      const preferred_currency = await c.get('userPreferencesRepository').savePreferredCurrency({
        preferredCurrency: payload.preferred_currency,
        onlyIfUnset: payload.only_if_unset ?? false,
      });

      const session = deps.getSession(c);

      return c.json(
        SessionResponseSchema.parse({
          ...session,
          user: { ...session.user, preferred_currency, has_preferred_currency_preference: true },
        }),
        { status: CONTENTFUL_STATUS_CODES.OK },
      );
    },
  });
}

import { AUTH_SESSION_CONTEXT_KEY, createAuthModule } from '@kamaalio/kamaal-auth-hono';
import type { Next } from 'hono';
import { every } from 'hono/combine';

import { BETTER_AUTH_BASE_PATH, JWKS_PATH } from './constants.ts';
import { type AuthLocals, authHooks, sessionExtras } from './hooks.ts';
import type { ApplicationConfig } from '../config.ts';
import { createPreferencesRoutes } from './routes/preferences.ts';
import type { SessionExtrasSchema } from './schemas/responses.ts';
import { ONE_DAY_IN_SECONDS } from '../constants/time.ts';
import type { HonoContext, HonoEnvironment } from '../context.ts';
import type { RequestLogger } from '../logging/index.ts';
import { openAPIRouterFactory } from '../open-api.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../schemas/errors.ts';

const TRUSTED_ORIGINS = ['tcg://'];

/**
 * The auth routes, middleware and schemas, assembled from this app's better-auth instance.
 *
 * The router is this app's own, so its `defaultHook` governs auth routes too and validation failures keep coming
 * back in the `InvalidValidation` envelope the rest of the API uses.
 */
export function createApplicationAuthModule(config: ApplicationConfig) {
  return createAuthModule<
    { id: string; email: string; name: string; emailVerified: boolean; createdAt: Date },
    { email: string; password: string; name: string; callbackURL?: string | undefined },
    { email: string; password: string; callbackURL?: string | undefined },
    typeof SessionExtrasSchema,
    AuthLocals,
    HonoEnvironment
  >({
    hooks: authHooks,
    router: openAPIRouterFactory(),
    config: {
      basePath: BETTER_AUTH_BASE_PATH,
      trustedOrigins: TRUSTED_ORIGINS,
      session: {
        expiresInSeconds: ONE_DAY_IN_SECONDS * config.BETTER_AUTH_SESSION_EXPIRY_DAYS,
        updateAgeSeconds: ONE_DAY_IN_SECONDS * config.BETTER_AUTH_SESSION_UPDATE_AGE_DAYS,
      },
      jwt: {
        issuer: config.BETTER_AUTH_URL,
        audience: config.BETTER_AUTH_URL,
        expiresInSeconds: ONE_DAY_IN_SECONDS * config.JWT_EXPIRY_DAYS,
        jwksUrl: new URL(`${BETTER_AUTH_BASE_PATH}${JWKS_PATH}`, config.BETTER_AUTH_URL),
      },
      isTest: config.IS_TEST,
      // Passed in rather than declared by the package, so these components are registered exactly once.
      errorSchemas: { error: ErrorResponseSchema, validation: ValidationErrorResponseSchema },
    },
    sessionExtras,
    extraRoutes: (router, deps) => {
      router.openapiRoutes(
        createPreferencesRoutes({
          ...deps,
          requireSessionMiddleware: every(deps.requireSessionMiddleware, bindSessionUser()),
        }),
      );
    },
    logger: (c): RequestLogger => c.get('logger'),
    locals: (c): AuthLocals => c,
    requestId: (c): string => c.get('requestId'),
  });
}

export type ApplicationAuthModule = ReturnType<typeof createApplicationAuthModule>;

function bindSessionUser() {
  return async (c: HonoContext, next: Next) => {
    const userId = c.get(AUTH_SESSION_CONTEXT_KEY)?.user.id;

    if (userId != null) {
      c.set('logger', c.get('logger').child({ user_id: userId }));
    }

    await next();
  };
}

export const requireSessionMiddleware = every(
  async (c: HonoContext, next: Next) => c.get('authModule').requireSessionMiddleware(c, next),
  bindSessionUser(),
);

export function getSession(c: HonoContext) {
  return c.get('authModule').getSession(c);
}

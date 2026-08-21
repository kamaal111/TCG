import { AUTH_SESSION_CONTEXT_KEY, createAuthModule } from '@kamaalio/kamaal-auth-hono';
import type { Next } from 'hono';
import { every } from 'hono/combine';

import { BETTER_AUTH_BASE_PATH, JWKS_URL } from './constants.ts';
import { type AuthLocals, authHooks } from './hooks.ts';
import { ONE_DAY_IN_SECONDS } from '../constants/common.ts';
import type { HonoContext } from '../context.ts';
import env from '../env.ts';
import { openAPIRouterFactory } from '../open-api.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../schemas/errors.ts';

const TRUSTED_ORIGINS = ['tcg://'];

/**
 * The auth routes, middleware and schemas, assembled from this app's better-auth instance.
 *
 * The router is this app's own, so its `defaultHook` governs auth routes too and validation failures keep coming
 * back in the `InvalidValidation` envelope the rest of the API uses.
 */
export const authModule = createAuthModule({
  hooks: authHooks,
  router: openAPIRouterFactory(),
  config: {
    basePath: BETTER_AUTH_BASE_PATH,
    trustedOrigins: TRUSTED_ORIGINS,
    session: {
      expiresInSeconds: ONE_DAY_IN_SECONDS * env.BETTER_AUTH_SESSION_EXPIRY_DAYS,
      updateAgeSeconds: ONE_DAY_IN_SECONDS * env.BETTER_AUTH_SESSION_UPDATE_AGE_DAYS,
    },
    jwt: {
      issuer: env.BETTER_AUTH_URL,
      audience: env.BETTER_AUTH_URL,
      expiresInSeconds: ONE_DAY_IN_SECONDS * env.JWT_EXPIRY_DAYS,
      jwksUrl: JWKS_URL,
    },
    isTest: env.IS_TEST,
    // Passed in rather than declared by the package, so these components are registered exactly once.
    errorSchemas: { error: ErrorResponseSchema, validation: ValidationErrorResponseSchema },
  },
  logger: c => c.get('logger'),
  locals: (c): AuthLocals => ({ db: c.get('db'), auth: c.get('auth') }),
  requestId: c => c.get('requestId'),
});

function bindSessionUser() {
  return async (c: HonoContext, next: Next) => {
    const userId = c.get(AUTH_SESSION_CONTEXT_KEY)?.user.id;
    if (userId != null) {
      c.set('logger', c.get('logger').child({ user_id: userId }));
    }

    await next();
  };
}

export const requireSessionMiddleware = every(authModule.requireSessionMiddleware, bindSessionUser());

export const { getSession } = authModule;

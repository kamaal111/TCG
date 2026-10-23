import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { betterAuth } from 'better-auth';
import { bearer, jwt } from 'better-auth/plugins';

import type { Auth } from '../../auth/client.ts';
import { BETTER_AUTH_BASE_PATH } from '../../auth/constants.ts';
import type { ApplicationConfig } from '../../config.ts';
import { ONE_DAY_IN_SECONDS } from '../../constants/time.ts';
import type { Database } from '../../db/index.ts';
import * as schema from '../../db/schema/index.ts';

const TRUSTED_ORIGINS = ['tcg://'];

export function createBetterAuth(db: Database, config: ApplicationConfig, secret?: string) {
  return betterAuth({
    secret,
    baseURL: config.BETTER_AUTH_URL,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    trustedOrigins: TRUSTED_ORIGINS,
    session: {
      expiresIn: ONE_DAY_IN_SECONDS * config.BETTER_AUTH_SESSION_EXPIRY_DAYS,
      updateAge: ONE_DAY_IN_SECONDS * config.BETTER_AUTH_SESSION_UPDATE_AGE_DAYS,
    },
    basePath: BETTER_AUTH_BASE_PATH,
    plugins: [
      bearer(),
      jwt({
        jwt: {
          issuer: config.BETTER_AUTH_URL,
          audience: config.BETTER_AUTH_URL,
          expirationTime: `${config.JWT_EXPIRY_DAYS}d`,
          definePayload: async ({ user, session }) => ({
            email: user.email,
            name: user.name,
            emailVerified: user.emailVerified,
            sessionExpiresAt: Math.floor(session.expiresAt.getTime() / 1000),
            sessionCreatedAt: Math.floor(session.createdAt.getTime() / 1000),
            sessionUpdatedAt: Math.floor(session.updatedAt.getTime() / 1000),
          }),
        },
      }),
    ],
  });
}

export function createAuth(db: Database, config: ApplicationConfig, secret?: string): Auth {
  const auth = createBetterAuth(db, config, secret);

  return {
    handler: request => auth.handler(request),
    api: { getSession: options => auth.api.getSession(options) },
    verificationKeys: () => db.query.jwks.findMany({ columns: { id: true, publicKey: true } }),
  };
}

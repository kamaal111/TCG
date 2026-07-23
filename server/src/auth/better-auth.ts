import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { betterAuth } from 'better-auth';
import { bearer, jwt } from 'better-auth/plugins';

import { BETTER_AUTH_BASE_PATH } from './constants.ts';
import { ONE_DAY_IN_SECONDS } from '../constants/common.ts';
import db, { type Database } from '../db/index.ts';
import * as schema from '../db/schema/index.ts';
import env from '../env.ts';

const TRUSTED_ORIGINS = ['tcg://'];
const EXPIRES_IN = ONE_DAY_IN_SECONDS * env.BETTER_AUTH_SESSION_EXPIRY_DAYS;
const UPDATE_AGE = ONE_DAY_IN_SECONDS * env.BETTER_AUTH_SESSION_UPDATE_AGE_DAYS;
const JWT_EXPIRATION_TIME = `${env.JWT_EXPIRY_DAYS}d`;

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(db: Database) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    trustedOrigins: TRUSTED_ORIGINS,
    session: { expiresIn: EXPIRES_IN, updateAge: UPDATE_AGE },
    basePath: BETTER_AUTH_BASE_PATH,
    plugins: [
      bearer(),
      jwt({
        jwt: {
          issuer: env.BETTER_AUTH_URL,
          audience: env.BETTER_AUTH_URL,
          expirationTime: JWT_EXPIRATION_TIME,
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

export const auth = createAuth(db);

import type { SessionExtras } from '@kamaalio/kamaal-auth-core';
import {
  type AuthCredentials,
  type AuthHookContext,
  type AuthHookResult,
  type AuthUser,
  ONE_DAY_IN_SECONDS,
  defineAuthHooks,
  getValueFromSetCookie,
} from '@kamaalio/kamaal-auth-hono';
import { type JWTPayload, decodeJwt } from 'jose';
import z from 'zod';

import { BETTER_AUTH_BASE_URL } from './constants.ts';
import type { HonoContext } from '../context.ts';
import env from '../env.ts';
import { SessionExtrasSchema } from './schemas/responses.ts';

export type AuthLocals = HonoContext;

const SESSION_COOKIE_NAME = 'better-auth.session_token';

const TOKEN_URL = new URL('token', BETTER_AUTH_BASE_URL);

const SESSION_UPDATE_AGE_SECONDS = ONE_DAY_IN_SECONDS * env.BETTER_AUTH_SESSION_UPDATE_AGE_DAYS;

const BetterAuthErrorSchema = z.object({ code: z.string(), message: z.string() });

const BetterAuthUserSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.coerce.date(),
});

const BetterAuthAuthenticatedSchema = z.object({ user: BetterAuthUserSchema });

const TokenResponseSchema = z.object({ token: z.string() });

const PublicJWKSchema = z.object({ kty: z.string() }).catchall(z.unknown());

/** Annotated on every hook so `defineAuthHooks` infers the locals type instead of widening to unknown. */
type Context = AuthHookContext<AuthLocals>;

export const authHooks = defineAuthHooks({
  async signUp(c: Context) {
    return authenticate(c);
  },

  async signIn(c: Context) {
    return authenticate(c);
  },

  async signOut(c: Context) {
    const response = await c.locals.get('auth').handler(c.request);

    // better-auth ends a cookie session by re-setting the cookie already expired; forward that to the client.
    return { ok: true, value: { headers: response.headers } };
  },

  async getSession(c: Context) {
    const result = await c.locals.get('auth').api.getSession({ headers: c.headers });

    if (result == null) {
      return { ok: true, value: null };
    }

    return {
      ok: true,
      value: {
        user: toAuthUser(result.user),
        session: {
          expiresAt: result.session.expiresAt,
          createdAt: result.session.createdAt,
          updatedAt: result.session.updatedAt,
        },
      },
    };
  },

  async issueToken(c: Context) {
    const response = await c.locals.get('auth').handler(c.request);

    if (!response.ok) {
      return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } };
    }

    const { token } = TokenResponseSchema.parse(await response.json());

    return { ok: true, value: { token, expiresInSeconds: expiresInSeconds(token) } };
  },

  async jwks(c: Context) {
    return c.locals.get('auth').handler(c.request);
  },

  /** Tests have no reachable JWKS endpoint, so verification reads the keys better-auth persisted. */
  async verificationKeys(c: Context) {
    const rows = await c.locals.get('db').query.jwks.findMany({ columns: { id: true, publicKey: true } });

    return {
      keys: rows.map(row => ({ ...PublicJWKSchema.parse(JSON.parse(row.publicKey)), kid: row.id })),
    };
  },

  /** Anything better-auth serves that this app does not model explicitly. */
  async fallback(c: Context) {
    return c.locals.get('auth').handler(c.request);
  },
});

/**
 * Runs a sign-up or sign-in through better-auth and mints the JWT that goes with the new session.
 *
 * The incoming request is forwarded as-is rather than rebuilt from the validated input, so fields better-auth
 * understands but this app does not model (`callbackURL`) keep working.
 */
async function authenticate(c: Context): Promise<AuthHookResult<{ user: AuthUser; credentials: AuthCredentials }>> {
  const response = await c.locals.get('auth').handler(c.request);
  const body: unknown = await response.json();

  const failure = BetterAuthErrorSchema.safeParse(body);

  if (failure.success) {
    return { ok: false, error: { ...failure.data, headers: response.headers } };
  }

  const sessionToken = getValueFromSetCookie(response.headers, SESSION_COOKIE_NAME);

  if (sessionToken == null) {
    return { ok: false, error: { code: 'MISSING_SESSION_TOKEN', message: 'Authentication response had no session' } };
  }

  const token = await mintToken(c, sessionToken);

  if (token == null) {
    return { ok: false, error: { code: 'MISSING_SESSION_TOKEN', message: 'Could not issue an authentication token' } };
  }

  return {
    ok: true,
    value: {
      user: toAuthUser(BetterAuthAuthenticatedSchema.parse(body).user),
      credentials: {
        sessionToken,
        authToken: token,
        authTokenExpiresInSeconds: expiresInSeconds(token),
        sessionUpdateAgeSeconds: SESSION_UPDATE_AGE_SECONDS,
      },
    },
  };
}

async function mintToken(c: Context, sessionToken: string): Promise<string | null> {
  const request = new Request(TOKEN_URL, {
    method: 'GET',
    headers: new Headers({ Authorization: `Bearer ${sessionToken}` }),
  });

  const response = await c.locals.get('auth').handler(request);

  if (!response.ok) {
    return null;
  }

  return TokenResponseSchema.parse(await response.json()).token;
}

function toAuthUser(user: z.infer<typeof BetterAuthUserSchema>): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  };
}

/** Seconds until the JWT expires, falling back to the configured lifetime when it carries no `exp`. */
function expiresInSeconds(token: string): number {
  const payload = decodeJwtSafely(token);

  if (payload?.exp == null) {
    return ONE_DAY_IN_SECONDS * env.JWT_EXPIRY_DAYS;
  }

  return payload.exp - Math.floor(Date.now() / 1000);
}

function decodeJwtSafely(token: string): JWTPayload | undefined {
  try {
    return decodeJwt(token);
  } catch {
    return undefined;
  }
}

export const sessionExtras: SessionExtras<typeof SessionExtrasSchema, AuthLocals> = {
  schema: SessionExtrasSchema,
  resolve: async (c, { userId }) => {
    const preferredCurrency = await c.locals.get('userPreferencesRepository').findPreferredCurrency(userId);

    const currency = preferredCurrency ?? env.DEFAULT_PREFERRED_CURRENCY;
    c.locals.set('preferredCurrency', currency);

    return { preferred_currency: currency };
  },
};

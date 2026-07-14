import { createMiddleware } from 'hono/factory';
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import z from 'zod';

import type { HonoContext, HonoEnvironment } from '../context.ts';
import env from '../env.ts';
import { logInfo, logWarn } from '../logging/index.ts';
import { withRequestLogger } from '../logging/http.ts';
import { APIException } from '../exceptions/index.ts';
import { STATUS_CODES } from '../constants/http.ts';
import { toISO8601String } from '../utils/strings.ts';
import type { SessionResponse } from './schemas/responses.ts';
import { SessionNotFound } from './exceptions.ts';
import { JWKS_URL } from './constants.ts';
import { jwks } from '../db/schema/index.ts';

const RemoteJWKS = createRemoteJWKSet(JWKS_URL);

const BetterAuthJWTPayloadSchema = z
  .object({ sub: z.string(), email: z.email(), name: z.string(), emailVerified: z.boolean() })
  .loose();

const PublicJWKSchema = z.object({ kty: z.string() }).catchall(z.unknown());

export const requireLoggedInSessionMiddleware = createMiddleware<HonoEnvironment>(async (c, next) => {
  const session = await getUserSession(c);
  c.set('session', session);
  await next();
});

async function getUserSession(c: HonoContext): Promise<SessionResponse> {
  const session = c.get('session');
  if (session != null) {
    return session;
  }

  const jwtSessionResponse = await verifyJwt(c);
  if (jwtSessionResponse != null) {
    return jwtSessionResponse;
  }

  return verifySession(c);
}

async function verifyJwt(c: HonoContext): Promise<SessionResponse | null> {
  const authHeader = c.req.header('Authorization');
  if (authHeader == null) return null;
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const jwks = await getJwksForVerification(c);
  let verificationResult: Awaited<ReturnType<typeof jwtVerify<JWTPayload>>>;
  try {
    verificationResult = await jwtVerify(token, jwks, {
      issuer: env.BETTER_AUTH_URL,
      audience: env.BETTER_AUTH_URL,
    });
  } catch (error) {
    logWarn(
      withRequestLogger(c, { component: 'auth' }),
      {
        event: 'auth.jwt.verification',
        outcome: 'failure',
        error_name: error instanceof Error ? error.name : typeof error,
      },
      'Authentication token verification failed.',
    );
    return null;
  }

  const payload = verificationResult.payload;
  const zResult = BetterAuthJWTPayloadSchema.safeParse(payload);
  if (!zResult.success) {
    throw new APIException(c, STATUS_CODES.UNAUTHORIZED, {
      message: 'Invalid JWT payload',
      code: 'INVALID_JWT_PAYLOAD',
    });
  }

  const jwtPayload = zResult.data;
  logInfo(
    withRequestLogger(c, { component: 'auth' }),
    {
      event: 'auth.jwt.verification',
      user_id: jwtPayload.sub,
      outcome: 'success',
    },
    'Verified authentication token.',
  );

  return {
    session: {
      expires_at: toISO8601String(new Date((payload.exp ?? 0) * 1000)),
      created_at: toISO8601String(new Date((payload.iat ?? 0) * 1000)),
      updated_at: toISO8601String(new Date()),
    },
    user: {
      id: jwtPayload.sub,
      name: jwtPayload.name,
      email: jwtPayload.email,
      email_verified: jwtPayload.emailVerified,
      created_at: toISO8601String(new Date((payload.iat ?? 0) * 1000)),
    },
  };
}

async function verifySession(c: HonoContext): Promise<SessionResponse> {
  const sessionResponse = await c.get('auth').api.getSession({ headers: c.req.raw.headers });
  if (!sessionResponse) {
    throw new SessionNotFound(c);
  }

  logInfo(
    withRequestLogger(c, { component: 'auth' }),
    {
      event: 'auth.session.lookup',
      user_id: sessionResponse.user.id,
      outcome: 'success',
    },
    'Retrieved the authenticated user session.',
  );

  const response: SessionResponse = {
    session: {
      expires_at: toISO8601String(sessionResponse.session.expiresAt),
      created_at: toISO8601String(sessionResponse.session.createdAt),
      updated_at: toISO8601String(sessionResponse.session.updatedAt),
    },
    user: {
      id: sessionResponse.user.id,
      name: sessionResponse.user.name,
      email: sessionResponse.user.email,
      email_verified: sessionResponse.user.emailVerified,
      created_at: toISO8601String(sessionResponse.user.createdAt),
    },
  };

  return response;
}

async function getJwksForVerification(c: HonoContext) {
  if (!env.IS_TEST) return RemoteJWKS;

  const keyRows = await c.get('db').select({ id: jwks.id, publicKey: jwks.publicKey }).from(jwks);
  const keys = keyRows.map(keyRow => ({ ...PublicJWKSchema.parse(JSON.parse(keyRow.publicKey)), kid: keyRow.id }));

  return createLocalJWKSet({ keys });
}

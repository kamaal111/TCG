import z from 'zod';
import { cloneRawRequest } from 'hono/request';
import { decodeJwt, type JWTPayload } from 'jose';

import type { HonoContext } from '../../context.ts';
import { BetterAuthException } from '../exceptions.ts';
import { getValueFromSetCookie } from '../../utils/request.ts';
import { APIException, Unauthorized } from '../../exceptions/index.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import env from '../../env.ts';
import { ONE_DAY_IN_SECONDS } from '../../constants/common.ts';
import { BETTER_AUTH_BASE_URL } from '../constants.ts';
import tokenRoute from '../routes/token.ts';

const TOKEN_URL = new URL(tokenRoute.path.slice(1), BETTER_AUTH_BASE_URL);

const BetterAuthExceptionSchema = z.object({
  code: z.string(),
  message: z.string(),
});

const TokenResponseSchema = z.object({
  token: z.string().optional(),
});

export async function handleAuthRequest<Schema extends z.ZodType>(
  c: HonoContext,
  options: { responseSchema: Schema },
): Promise<{ jsonResponse: z.infer<Schema>; sessionToken: string }> {
  const request = await cloneRawRequest(c.req);
  const response = await c.get('auth').handler(request);
  const jsonResponse: unknown = await response.json();
  const exceptionResult = BetterAuthExceptionSchema.safeParse(jsonResponse);
  if (exceptionResult.success) {
    throw new BetterAuthException(c, {
      code: exceptionResult.data.code,
      message: exceptionResult.data.message,
      headers: response.headers,
    });
  }

  const validatedResponse = options.responseSchema.parse(jsonResponse);
  const sessionToken = getValueFromSetCookie(response.headers, 'better-auth.session_token');
  if (!sessionToken) {
    throw new APIException(c, STATUS_CODES.INTERNAL_SERVER_ERROR, {
      message: 'Failed to retrieve session token from authentication response',
      code: 'MISSING_SESSION_TOKEN',
    });
  }

  return { jsonResponse: validatedResponse, sessionToken };
}

export async function getHeadersWithJwtAfterAuth(c: HonoContext, sessionToken: string): Promise<Headers> {
  const tokenRequestHeaders = new Headers({ Authorization: `Bearer ${sessionToken}` });
  const tokenRequest = new Request(TOKEN_URL, { method: 'GET', headers: tokenRequestHeaders });
  const response = await c.get('auth').handler(tokenRequest);
  if (!response.ok) {
    throw new Unauthorized(c);
  }

  const responseJson: unknown = await response.json();
  const responseData = TokenResponseSchema.parse(responseJson);
  const headers = createHeadersWithJwt(responseData.token);

  headers.set('set-session-token', sessionToken);
  const sessionUpdateAgeSeconds = ONE_DAY_IN_SECONDS * env.BETTER_AUTH_SESSION_UPDATE_AGE_DAYS;
  headers.set('set-session-update-age', sessionUpdateAgeSeconds.toString());

  return headers;
}

function createHeadersWithJwt(jwt: string | undefined): Headers {
  const headers = new Headers();
  headers.set('content-type', 'application/json');

  if (!jwt) return headers;

  let payload: JWTPayload | undefined;
  try {
    payload = decodeJwt(jwt);
  } catch {
    // Swallow
  }

  const expirySeconds = payload?.exp
    ? payload.exp - Math.floor(Date.now() / 1000)
    : ONE_DAY_IN_SECONDS * env.JWT_EXPIRY_DAYS;
  headers.set('set-auth-token', jwt);
  headers.set('set-auth-token-expiry', expirySeconds.toString());

  return headers;
}

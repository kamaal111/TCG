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
import { BetterAuthSignUpOrSignInResponseSchema, type AuthResponse } from '../schemas/responses.ts';
import { mapSignUpOrSignInBetterAuthRequestToAuthResponse } from '../../mappers.ts';

const TOKEN_URL = new URL(tokenRoute.path.slice(1), BETTER_AUTH_BASE_URL);

const DefaultResponseSchema = z.any();

const BetterAuthExceptionSchema = z.object({
  code: z.string(),
  message: z.string(),
});

const TokenResponseSchema = z.object({
  token: z.string().optional(),
});

export async function handleSignUpOrSignInRequest(
  c: HonoContext,
): Promise<{ response: AuthResponse; headers: Headers }> {
  const { jsonResponse, sessionToken } = await handleAuthRequest(c, {
    responseSchema: BetterAuthSignUpOrSignInResponseSchema,
  });
  const headers = await getHeadersWithJwtAfterAuth(c, sessionToken);

  return { response: mapSignUpOrSignInBetterAuthRequestToAuthResponse(jsonResponse), headers };
}

export async function handleAuthRequest<Schema extends z.ZodType>(
  c: HonoContext,
  options: { responseSchema: Schema },
): Promise<{ jsonResponse: z.infer<Schema>; responseHeaders: Headers; sessionToken: string }> {
  const { jsonResponse, responseHeaders, response } = await performAuthRequest(c, options.responseSchema);
  const sessionToken = getValueFromSetCookie(response.headers, 'better-auth.session_token');
  if (!sessionToken) {
    throw new APIException(c, STATUS_CODES.INTERNAL_SERVER_ERROR, {
      message: 'Failed to retrieve session token from authentication response',
      code: 'MISSING_SESSION_TOKEN',
    });
  }

  return { jsonResponse, responseHeaders, sessionToken };
}

export async function handleAuthRequestWithoutSessionToken<Schema extends z.ZodType>(
  c: HonoContext,
  options?: { responseSchema: Schema },
): Promise<{ jsonResponse: z.infer<Schema>; responseHeaders: Headers }> {
  const responseSchema = options?.responseSchema ?? DefaultResponseSchema;
  const { jsonResponse, responseHeaders } = await performAuthRequest(c, responseSchema);

  return { jsonResponse, responseHeaders };
}

async function performAuthRequest<Schema extends z.ZodType>(
  c: HonoContext,
  responseSchema: Schema,
): Promise<{ jsonResponse: z.infer<Schema>; response: Response; responseHeaders: Headers }> {
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

  return { jsonResponse: responseSchema.parse(jsonResponse), response, responseHeaders: response.headers };
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

import { cloneRawRequest } from 'hono/request';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import type { HonoContext } from '../../context.ts';
import { AUTH_ROUTE_NAME } from '../constants.ts';
import tokenRoute from '../routes/token.ts';
import { SessionNotFound } from '../exceptions.ts';
import { logInfo } from '../../logging/index.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { parseTokenResponseAndCreateHeaders } from '../utils/request.ts';
import type { TypedResponse } from 'hono';

type TokenContext = HonoContext<typeof TOKEN_ROUTE_PATH>;
type TokenResponse = TypedResponse<{ token: string }, typeof TOKEN_STATUS_CODE>;

export const TOKEN_ROUTE_PATH = `${APP_API_ROUTE_NAME}${AUTH_ROUTE_NAME}${tokenRoute.path}` as const;
const TOKEN_STATUS_CODE = STATUS_CODES.OK;

async function tokenHandler(c: TokenContext): Promise<TokenResponse> {
  const request = await cloneRawRequest(c.req);
  const response = await c.get('auth').handler(request);
  if (!response.ok) {
    throw new SessionNotFound(c);
  }

  const authHeader = c.req.header('authorization');
  const sessionToken = authHeader?.replace(/^Bearer\s+/i, '') ?? null;
  const { token, headers } = await parseTokenResponseAndCreateHeaders(response, sessionToken);
  logInfo(withRequestLogger(c, { component: 'auth' }), {
    event: 'auth.token.issued',
    route: TOKEN_ROUTE_PATH,
    outcome: 'success',
  });

  return c.json({ token }, { status: TOKEN_STATUS_CODE, headers });
}

export default tokenHandler;

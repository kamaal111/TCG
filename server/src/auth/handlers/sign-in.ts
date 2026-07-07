import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { AUTH_ROUTE_NAME } from '../constants.ts';
import signInRoute from '../routes/sign-in.ts';
import { AuthResponseSchema, type AuthResponse } from '../schemas/responses.ts';
import { getHeadersWithJwtAfterAuth, handleAuthRequest } from '../utils/request.ts';
import type { EmailPasswordSignIn } from '../schemas/payloads.ts';

type SignInResponse = TypedResponse<AuthResponse, typeof SIGN_IN_STATUS>;
type SignInContext = HonoContext<typeof SIGN_IN_ROUTE_PATH, { out: { json: EmailPasswordSignIn } }>;

export const SIGN_IN_ROUTE_PATH = `${APP_API_ROUTE_NAME}${AUTH_ROUTE_NAME}${signInRoute.path}` as const;

const SIGN_IN_STATUS = STATUS_CODES.OK;

async function signInHandler(c: SignInContext): Promise<SignInResponse> {
  const { jsonResponse, sessionToken } = await handleAuthRequest(c, { responseSchema: AuthResponseSchema });
  const headers = await getHeadersWithJwtAfterAuth(c, sessionToken);
  logInfo(withRequestLogger(c, { component: 'auth' }), {
    event: 'auth.sign_in.succeeded',
    route: SIGN_IN_ROUTE_PATH,
    outcome: 'success',
  });

  return c.json(jsonResponse, { status: SIGN_IN_STATUS, headers });
}

export default signInHandler;

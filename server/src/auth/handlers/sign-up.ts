import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { AUTH_ROUTE_NAME } from '../constants.ts';
import signUpRoute from '../routes/sign-up.ts';
import { getHeadersWithJwtAfterAuth, handleAuthRequest } from '../utils/request.ts';
import { AuthResponseSchema, type AuthResponse } from '../schemas/responses.ts';
import type { EmailPasswordSignUp } from '../schemas/payloads.ts';

type SignUpResponse = TypedResponse<AuthResponse, typeof SIGN_UP_STATUS>;
type SignUpContext = HonoContext<typeof SIGN_UP_ROUTE_PATH, { out: { json: EmailPasswordSignUp } }>;

export const SIGN_UP_ROUTE_PATH = `${APP_API_ROUTE_NAME}${AUTH_ROUTE_NAME}${signUpRoute.path}` as const;

const SIGN_UP_STATUS = STATUS_CODES.CREATED;

async function signUpHandler(c: SignUpContext): Promise<SignUpResponse> {
  const { jsonResponse, sessionToken } = await handleAuthRequest(c, { responseSchema: AuthResponseSchema });
  const headers = await getHeadersWithJwtAfterAuth(c, sessionToken);
  logInfo(withRequestLogger(c, { component: 'auth' }), {
    event: 'auth.sign_up.succeeded',
    route: SIGN_UP_ROUTE_PATH,
    outcome: 'success',
  });

  return c.json(jsonResponse, { status: SIGN_UP_STATUS, headers });
}

export default signUpHandler;

import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { AUTH_ROUTE_NAME } from '../constants.ts';
import signOutRoute from '../routes/sign-out.ts';
import type { SignOutResponse } from '../schemas/payloads.ts';
import { handleAuthRequestWithoutSessionToken } from '../utils/request.ts';

type SignOutContext = HonoContext<typeof SIGN_OUT_ROUTE_PATH>;

export const SIGN_OUT_ROUTE_PATH = `${APP_API_ROUTE_NAME}${AUTH_ROUTE_NAME}${signOutRoute.path}` as const;

const SIGN_OUT_STATUS = STATUS_CODES.OK;

async function signOutHandler(c: SignOutContext): Promise<TypedResponse<SignOutResponse, typeof SIGN_OUT_STATUS>> {
  const { responseHeaders } = await handleAuthRequestWithoutSessionToken(c);

  logInfo(withRequestLogger(c, { component: 'auth' }), {
    event: 'auth.sign_out.succeeded',
    route: SIGN_OUT_ROUTE_PATH,
    outcome: 'success',
  });

  return c.json({}, { status: SIGN_OUT_STATUS, headers: responseHeaders });
}

export default signOutHandler;

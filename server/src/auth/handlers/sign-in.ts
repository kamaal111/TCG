import type { TypedResponse } from 'hono';

import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoContext } from '../../context.ts';
import { withRequestLogger } from '../../logging/http.ts';
import { logInfo } from '../../logging/index.ts';
import { AUTH_ROUTE_NAME } from '../constants.ts';
import signInRoute from '../routes/sign-in.ts';
import type { AuthResponse } from '../schemas/responses.ts';
import { handleSignUpOrSignInRequest } from '../utils/request.ts';
import type { EmailPasswordSignIn } from '../schemas/payloads.ts';

type SignInResponse = TypedResponse<AuthResponse, typeof SIGN_IN_STATUS>;
type SignInContext = HonoContext<typeof SIGN_IN_ROUTE_PATH, { out: { json: EmailPasswordSignIn } }>;

export const SIGN_IN_ROUTE_PATH = `${APP_API_ROUTE_NAME}${AUTH_ROUTE_NAME}${signInRoute.path}` as const;

const SIGN_IN_STATUS = STATUS_CODES.OK;

async function signInHandler(c: SignInContext): Promise<SignInResponse> {
  const { response, headers } = await handleSignUpOrSignInRequest(c);
  logInfo(
    withRequestLogger(c, { component: 'auth' }),
    {
      event: 'auth.sign_in.succeeded',
      route: SIGN_IN_ROUTE_PATH,
      outcome: 'success',
    },
    'Signed in with email and password.',
  );

  return c.json(response, { status: SIGN_IN_STATUS, headers });
}

export default signInHandler;

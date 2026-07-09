import type { TypedResponse } from 'hono';

import type { HonoContext } from '../../context.ts';
import { SessionResponseSchema, type SessionResponse } from '../schemas/responses.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { getSessionWhereSessionIsRequired } from '../utils/session.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { AUTH_ROUTE_NAME } from '../constants.ts';
import sessionRoute from '../routes/session.ts';

type SessionContext = HonoContext<typeof SESSION_ROUTE_PATH>;

export const SESSION_ROUTE_PATH = `${APP_API_ROUTE_NAME}${AUTH_ROUTE_NAME}${sessionRoute.path}` as const;
const SESSION_STATUS_CODE = STATUS_CODES.OK;

function sessionHandler(c: SessionContext): TypedResponse<SessionResponse, typeof SESSION_STATUS_CODE> {
  const session = getSessionWhereSessionIsRequired(c);

  return c.json(SessionResponseSchema.parse(session), { status: SESSION_STATUS_CODE });
}

export default sessionHandler;

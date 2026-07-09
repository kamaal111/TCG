import type { TypedResponse } from 'hono';

import type { HonoContext } from '../../context.ts';
import { SessionResponseSchema, type SessionResponse } from '../schemas/responses.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { getSessionWhereSessionIsRequired } from '../utils/session.ts';

const SESSION_STATUS_CODE = STATUS_CODES.OK;

function sessionHandler(c: HonoContext): TypedResponse<SessionResponse, typeof SESSION_STATUS_CODE> {
  const session = getSessionWhereSessionIsRequired(c);

  return c.json(SessionResponseSchema.parse(session), { status: SESSION_STATUS_CODE });
}

export default sessionHandler;

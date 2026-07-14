import type { HonoContext } from '../../context.ts';
import { SessionNotFound } from '../exceptions.ts';

export function getSessionWhereSessionIsRequired(c: HonoContext) {
  const session = c.get('session');
  if (session == null) {
    throw new SessionNotFound(c);
  }

  return session;
}

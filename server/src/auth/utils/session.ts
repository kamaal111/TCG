import type { HonoContext } from '../../context.ts';

export function getSessionWhereSessionIsRequired(c: HonoContext) {
  const session = c.get('session');
  assert(session != null);

  return session;
}

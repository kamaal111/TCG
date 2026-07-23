import type { Context, Input, Next } from 'hono';
import type { RequestIdVariables } from 'hono/request-id';
import type { Logger } from 'pino';

import type { Database } from './db/index.ts';
import type { Auth } from './auth/better-auth.ts';
import type { SessionResponse } from './auth/schemas/responses.ts';
import type { TCGGOClient } from './card-pricing/tcggo/client.ts';

export interface InjectedContext {
  db: Database;
  auth: Auth;
  tcggo: TCGGOClient;
}

interface LoggingVariables {
  logger: Logger;
}

interface RequestLifecycleVariables {
  requestFailed?: boolean;
}

export type HonoVariables = RequestIdVariables &
  InjectedContext &
  LoggingVariables &
  RequestLifecycleVariables & { session?: SessionResponse };

export interface HonoEnvironment {
  Variables: HonoVariables;
}

export type HonoContext<P extends string = string, I extends Input = Record<string, unknown>> = Context<
  HonoEnvironment,
  P,
  I
>;

export function injectRequestContext({ db, auth, tcggo }: InjectedContext) {
  return async (c: HonoContext, next: Next) => {
    c.set('db', db);
    c.set('auth', auth);
    c.set('tcggo', tcggo);
    await next();
  };
}

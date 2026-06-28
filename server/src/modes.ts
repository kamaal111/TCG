import { createMiddleware } from 'hono/factory';

import type { HonoVariables } from './context.ts';
import env from './env.ts';
import { NotFound } from './exceptions/index.ts';

export type ServerMode = (typeof SERVER_MODES)[keyof typeof SERVER_MODES];

export const SERVER_MODES = { SERVER: 'SERVER', TEST: 'TEST' } as const;

export function allowedModes(...modes: ServerMode[]) {
  return createMiddleware<{ Variables: HonoVariables }>(async (c, next) => {
    if (env.MODE !== SERVER_MODES.TEST && !modes.includes(env.MODE)) {
      throw new NotFound(c);
    }

    await next();
  });
}

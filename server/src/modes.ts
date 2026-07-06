import { createMiddleware } from 'hono/factory';

import type { HonoVariables } from './context.ts';
import env from './env.ts';
import { NotFound } from './exceptions/index.ts';
import { SERVER_MODES, type ServerMode } from './constants/common.ts';

export function allowedModes(...modes: ServerMode[]) {
  return createMiddleware<{ Variables: HonoVariables }>(async (c, next) => {
    if (env.MODE !== SERVER_MODES.TEST && !modes.includes(env.MODE)) {
      throw new NotFound(c);
    }

    await next();
  });
}

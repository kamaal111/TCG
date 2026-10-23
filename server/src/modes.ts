import { createMiddleware } from 'hono/factory';

import { SERVER_MODES, type ServerMode } from './constants/common.ts';
import type { HonoVariables } from './context.ts';
import { NotFound } from './exceptions/index.ts';

export function allowedModes(...modes: ServerMode[]) {
  return createMiddleware<{ Variables: HonoVariables }>(async (c, next) => {
    if (c.get('config').MODE !== SERVER_MODES.TEST && !modes.includes(c.get('config').MODE)) {
      throw new NotFound(c);
    }

    await next();
  });
}

import { SERVER_MODES, type ServerMode } from '@tcg/http/common';
import { NotFound } from '@tcg/http/exceptions';
import { createMiddleware } from 'hono/factory';

import type { HonoVariables } from './context.ts';

export function allowedModes(...modes: ServerMode[]) {
  return createMiddleware<{ Variables: HonoVariables }>(async (c, next) => {
    if (c.get('config').MODE !== SERVER_MODES.TEST && !modes.includes(c.get('config').MODE)) {
      throw new NotFound(c);
    }

    await next();
  });
}

import { OpenAPIHono } from '@hono/zod-openapi';
import type { BlankSchema } from 'hono/types';

import type { HonoEnvironment } from './context.ts';
import { InvalidValidation } from './exceptions/index.ts';

export function openAPIRouterFactory(): OpenAPIHono<HonoEnvironment, BlankSchema, '/'> {
  const router = new OpenAPIHono<HonoEnvironment>({
    defaultHook: (result, c) => {
      if (!result.success) {
        throw new InvalidValidation(c, result.error);
      }
    },
  });

  return router;
}

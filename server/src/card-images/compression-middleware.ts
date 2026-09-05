import type { MiddlewareHandler } from 'hono';
import { compress } from 'hono/compress';

import { IMAGES_PATH_PREFIX } from './constants.ts';
import type { HonoEnvironment } from '../context.ts';

function cardImageAwareCompressionMiddleware(): MiddlewareHandler<HonoEnvironment> {
  const compressMiddleware = compress();

  return (c, next) => {
    if (c.req.path.startsWith(IMAGES_PATH_PREFIX)) {
      return next();
    }

    return compressMiddleware(c, next);
  };
}

export default cardImageAwareCompressionMiddleware;

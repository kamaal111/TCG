import type { HonoContext } from '../../context.ts';
import type { IMAGES_PATH_PREFIX } from '../constants.ts';
import type { GetImageParams } from '../schemas/params.ts';

type GetImageContext = HonoContext<`${typeof IMAGES_PATH_PREFIX}/:imageKey`, { out: { param: GetImageParams } }>;

export default function getImageHandler(c: GetImageContext): Promise<Response> {
  return c.get('cardImageService').get(c.req.valid('param').imageKey);
}

import { createRoute } from '@kamaalio/hono-standard-openapi';

import { CONTENTFUL_STATUS_CODES, CONTENTLESS_STATUS_CODES } from '../../constants/http.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';
import { IMAGES_OPENAPI_TAG } from '../constants.ts';
import { GetImageParamsSchema } from '../schemas/params.ts';

const getImageRoute = createRoute({
  method: 'get',
  path: '/{imageKey}',
  tags: [IMAGES_OPENAPI_TAG],
  summary: 'Get a card image',
  description: 'Proxy a cached card image, materializing and persisting it from the origin on first request.',
  request: { params: GetImageParamsSchema },
  responses: {
    [CONTENTFUL_STATUS_CODES.OK]: { description: 'Card image', content: { 'image/*': {} } },
    [CONTENTLESS_STATUS_CODES.NOT_MODIFIED]: { description: 'Card image not modified' },
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid image key',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.NOT_FOUND]: {
      description: 'Card image not found',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE]: {
      description: 'Card image temporarily unavailable',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  },
});

export default getImageRoute;

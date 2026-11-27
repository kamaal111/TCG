import { ErrorResponseSchema, ValidationErrorResponseSchema } from '@tcg/http/error-schemas';
import { MIME_TYPES } from '@tcg/http/mime';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import { SETS_OPENAPI_TAG } from './constants.ts';
import { requireSessionMiddleware } from '../auth/module.ts';

export const authenticated = {
  tags: [SETS_OPENAPI_TAG],
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
};

export const setErrorResponses = {
  [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: {
    description: 'Invalid request or cursor',
    content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
  },
  [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: {
    description: 'Authenticated session required',
    content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
  },
  [CONTENTFUL_STATUS_CODES.NOT_FOUND]: {
    description: 'Set or card not found',
    content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
  },
  [CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE]: {
    description: 'Catalog or pricing unavailable',
    content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
  },
};

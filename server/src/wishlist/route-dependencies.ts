import { ErrorResponseSchema, ValidationErrorResponseSchema } from '@tcg/http/error-schemas';
import { MIME_TYPES } from '@tcg/http/mime';

import { WISHLIST_OPENAPI_TAG } from './constants.ts';
import { requireSessionMiddleware } from '../auth/module.ts';

export const authenticated = {
  tags: [WISHLIST_OPENAPI_TAG],
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
};

export const unauthorized = {
  description: 'Authentication required',
  content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
};

export const invalid = {
  description: 'Invalid wishlist input',
  content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
};

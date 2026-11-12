import { ErrorResponseSchema, ValidationErrorResponseSchema } from '@tcg/http/error-schemas';
import { MIME_TYPES } from '@tcg/http/mime';

import { CARDS_OPENAPI_TAG } from './constants.ts';
import { requireSessionMiddleware } from '../auth/module.ts';

export const authenticated = {
  tags: [CARDS_OPENAPI_TAG],
  middleware: [requireSessionMiddleware] as const,
  security: [{ bearerAuth: [] }],
};

export const unauthorized = {
  description: 'Authenticated session not found',
  content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
};

export const invalid = {
  description: 'Invalid offline collection request',
  content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
};

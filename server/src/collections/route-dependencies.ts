import { COLLECTIONS_OPENAPI_TAG } from './constants.ts';
import { collectionRequestLimits } from './request-limits.ts';
import type { CollectionPolicy } from './types.ts';
import { requireSessionMiddleware } from '../auth/module.ts';
import { CONTENTFUL_STATUS_CODES } from '../constants/http.ts';
import { MIME_TYPES } from '../constants/request.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../schemas/errors.ts';
import { createCollectionRequestSchemas } from './schemas/payloads.ts';

export function createCollectionRouteDependencies(policy: CollectionPolicy) {
  const schemas = createCollectionRequestSchemas(policy);

  const common = {
    tags: [COLLECTIONS_OPENAPI_TAG],
    middleware: [requireSessionMiddleware, collectionRequestLimits(policy)],
    security: [{ bearerAuth: [] }],
  };

  const errors = {
    [CONTENTFUL_STATUS_CODES.REQUEST_TIMEOUT]: {
      description: 'Request read timeout',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.PAYLOAD_TOO_LARGE]: {
      description: 'Collection request exceeds server limits',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.TOO_MANY_REQUESTS]: {
      description: 'Account collection operation already in progress',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE]: {
      description: 'Collection processing busy or timed out',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid collection input',
      content: { [MIME_TYPES.JSON]: { schema: ValidationErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authentication required',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.NOT_FOUND]: {
      description: 'Resource not found or inaccessible',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.CONFLICT]: {
      description: 'Stale revision or insufficient available copies',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
    [CONTENTFUL_STATUS_CODES.INTERNAL_SERVER_ERROR]: {
      description: 'Unexpected failure',
      content: { [MIME_TYPES.JSON]: { schema: ErrorResponseSchema } },
    },
  };

  return { common, errors, schemas, policy };
}

export type CollectionRouteDependencies = ReturnType<typeof createCollectionRouteDependencies>;

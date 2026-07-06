import { createRoute, z } from '@hono/zod-openapi';

import { AUTH_OPENAPI_TAG } from '../constants.ts';
import { MIME_TYPES } from '../../constants/request.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { AuthResponseSchema } from '../schemas/responses.ts';
import { TokenHeaders } from '../schemas/headers.ts';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../../schemas/errors.ts';

const EmailPasswordSignUpSchema = z
  .object({
    email: z.email().openapi({
      description: 'User email address',
      example: 'john.doe@example.com',
    }),
    password: z.string().min(8).max(128).openapi({
      description: 'User password (minimum 8 characters)',
      example: 'SecurePassword123!',
    }),
    name: z
      .string()
      .min(3)
      .refine(val => val === val.trim(), {
        message: 'Name must not have leading or trailing spaces',
      })
      .refine(val => /^[^\s]+(\s[^\s]+)+$/.test(val), {
        message: 'Name must contain at least 2 words separated by single spaces',
      })
      .refine(val => val.split(/\s+/).every(word => /[a-zA-Z]/.test(word)), {
        message: 'Each word must contain at least one letter',
      })
      .openapi({
        description: 'User display name (minimum 2 words, each with at least one letter)',
        example: 'John Doe',
      }),
    callbackURL: z.url().optional().openapi({
      description: 'URL to redirect to after sign up',
      example: 'https://example.com/dashboard',
    }),
  })
  .openapi('EmailPasswordSignUp', {
    title: 'Email Password Sign Up',
    description: 'Request body for signing up with email and password',
    example: {
      email: 'john.doe@example.com',
      password: 'SecurePassword123!',
      name: 'John Doe',
      callbackURL: 'https://example.com/dashboard',
    },
  });

const signUpRoute = createRoute({
  method: 'post',
  path: '/sign-up/email',
  tags: [AUTH_OPENAPI_TAG],
  summary: 'Sign up with email and password',
  description: 'Create a new user account with email and password',
  request: {
    body: {
      content: {
        [MIME_TYPES.APPLICATION_JSON]: { schema: EmailPasswordSignUpSchema },
      },
    },
  },
  responses: {
    [STATUS_CODES.CREATED]: {
      description: 'Account created successfully',
      content: {
        [MIME_TYPES.APPLICATION_JSON]: { schema: AuthResponseSchema },
      },
      headers: TokenHeaders,
    },
    [STATUS_CODES.BAD_REQUEST]: {
      description: 'Invalid request or email already exists',
      content: {
        [MIME_TYPES.APPLICATION_JSON]: { schema: ValidationErrorResponseSchema },
      },
    },
    [STATUS_CODES.CONFLICT]: {
      description: 'Email already registered',
      content: {
        [MIME_TYPES.APPLICATION_JSON]: { schema: ErrorResponseSchema },
      },
    },
    [STATUS_CODES.UNAUTHORIZED]: {
      description: 'Authentication failed or invalid credentials',
      content: {
        [MIME_TYPES.APPLICATION_JSON]: { schema: ErrorResponseSchema },
      },
    },
  },
});

export default signUpRoute;

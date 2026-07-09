import { z } from '@hono/zod-openapi';

import { ApiCommonDatetimeShape } from '../../schemas/common.ts';

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export type BetterAuthSignUpOrSignInResponse = z.infer<typeof BetterAuthSignUpOrSignInResponseSchema>;

export const UserSchema = z
  .object({
    id: z.string().nonempty().openapi({
      description: 'Unique identifier for the authenticated user',
      example: 'user_2f0b63e4b3a44df0b2f099b1c8f52765',
    }),
    created_at: z.iso.datetime().openapi({
      description: 'Timestamp when the user account was created',
      example: '2026-07-07T10:30:00.000Z',
    }),
    email: z.email().openapi({
      description: 'Email address for the authenticated user',
      example: 'test@example.com',
    }),
    email_verified: z.boolean().openapi({
      description: 'Whether the user has verified their email address',
      example: false,
    }),
    name: z.string().nonempty().openapi({
      description: 'Display name for the authenticated user',
      example: 'Test User',
    }),
  })
  .openapi('UserSchema', {
    title: 'User',
    description: 'Authenticated user details',
    example: {
      id: 'user_2f0b63e4b3a44df0b2f099b1c8f52765',
      created_at: '2026-07-07T10:30:00.000Z',
      updated_at: '2026-07-07T10:30:00.000Z',
      email: 'test@example.com',
      email_verified: false,
      name: 'Test User',
    },
  });

export const SessionResponseSchema = z
  .object({
    session: z.object({
      expires_at: ApiCommonDatetimeShape.openapi({
        description: 'Session expiration timestamp',
        example: '2025-10-12T12:08:28.382Z',
      }),
      created_at: ApiCommonDatetimeShape.openapi({
        description: 'Session creation timestamp',
        example: '2025-10-05T12:08:28.382Z',
      }),
      updated_at: ApiCommonDatetimeShape.openapi({
        description: 'Session last update timestamp',
        example: '2025-10-05T12:08:28.382Z',
      }),
    }),
    user: UserSchema,
  })
  .openapi('SessionResponse', {
    title: 'Session Response',
    description: 'Session response containing session and user information',
    example: {
      session: {
        expires_at: '2025-10-12T12:08:28.382Z',
        created_at: '2025-10-05T12:08:28.382Z',
        updated_at: '2025-10-05T12:08:28.382Z',
      },
      user: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'John Doe',
        email: 'john@apple.com',
        email_verified: false,
        created_at: '2025-10-05T12:08:28.374Z',
      },
    },
  });

export const AuthResponseSchema = z
  .object({
    token: z.string().nonempty().openapi({
      description: 'Authentication token for the signed-in user',
      example: 'f21wcpz7Aokmlh2MB632MZpTgfruPc62',
    }),
    user: UserSchema,
  })
  .openapi('AuthResponse', {
    title: 'Authentication Response',
    description: 'Successful authentication response containing an authentication token and user details',
    example: {
      token: 'f21wcpz7Aokmlh2MB632MZpTgfruPc62',
      user: {
        id: 'user_2f0b63e4b3a44df0b2f099b1c8f52765',
        createdAt: '2026-07-07T10:30:00.000Z',
        updatedAt: '2026-07-07T10:30:00.000Z',
        email: 'test@example.com',
        emailVerified: false,
        name: 'Test User',
        image: 'https://example.com/avatar.png',
      },
    },
  });

export const BetterAuthSignUpOrSignInResponseSchema = z.object({
  token: AuthResponseSchema.shape.token,
  user: UserSchema.pick({ id: true, email: true, name: true }).extend({
    createdAt: UserSchema.shape.created_at,
    emailVerified: UserSchema.shape.email_verified,
  }),
});

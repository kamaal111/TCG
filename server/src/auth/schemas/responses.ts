import { z } from '@hono/zod-openapi';

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

const AuthUserResponseSchema = z
  .object({
    id: z.string().nonempty().openapi({
      description: 'Unique identifier for the authenticated user',
      example: 'user_2f0b63e4b3a44df0b2f099b1c8f52765',
    }),
    createdAt: z.iso.datetime().openapi({
      description: 'Timestamp when the user account was created',
      example: '2026-07-07T10:30:00.000Z',
    }),
    updatedAt: z.iso.datetime().openapi({
      description: 'Timestamp when the user account was last updated',
      example: '2026-07-07T10:30:00.000Z',
    }),
    email: z.email().openapi({
      description: 'Email address for the authenticated user',
      example: 'test@example.com',
    }),
    emailVerified: z.boolean().openapi({
      description: 'Whether the user has verified their email address',
      example: false,
    }),
    name: z.string().nonempty().openapi({
      description: 'Display name for the authenticated user',
      example: 'Test User',
    }),
    image: z.url().nullable().optional().openapi({
      description: 'Profile image URL for the authenticated user when available',
      example: 'https://example.com/avatar.png',
    }),
  })
  .openapi('AuthUserResponse', {
    title: 'Authenticated User',
    description: 'Authenticated user details returned after a successful sign-in or sign-up',
    example: {
      id: 'user_2f0b63e4b3a44df0b2f099b1c8f52765',
      createdAt: '2026-07-07T10:30:00.000Z',
      updatedAt: '2026-07-07T10:30:00.000Z',
      email: 'test@example.com',
      emailVerified: false,
      name: 'Test User',
      image: 'https://example.com/avatar.png',
    },
  });

export const AuthResponseSchema = z
  .object({
    token: z.string().nonempty().openapi({
      description: 'Authentication token for the signed-in user',
      example: 'f21wcpz7Aokmlh2MB632MZpTgfruPc62',
    }),
    user: AuthUserResponseSchema,
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

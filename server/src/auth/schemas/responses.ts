import { z } from '@hono/zod-openapi';

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const AuthResponseSchema = z
  .object({
    token: z.string().nonempty().openapi({
      description: 'Authentication token for the signed-in user',
      example: 'f21wcpz7Aokmlh2MB632MZpTgfruPc62',
    }),
  })
  .openapi('AuthResponse', {
    title: 'Authentication Response',
    description: 'Successful authentication response containing authentication token',
    example: { token: 'f21wcpz7Aokmlh2MB632MZpTgfruPc62' },
  });

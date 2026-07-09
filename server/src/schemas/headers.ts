import { z } from '@hono/zod-openapi';

export const AuthenticationHeaders = z.object({
  authorization: z.string().openapi({
    description: 'Bearer token for authentication',
    example: 'Bearer f21wcpz7Aokmlh2MB632MZpTgfruPc62',
  }),
});

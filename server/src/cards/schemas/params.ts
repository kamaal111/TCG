import { z } from '@hono/zod-openapi';

export const CardIdParamsSchema = z.object({
  cardId: z
    .string()
    .nonempty()
    .openapi({
      param: { name: 'cardId', in: 'path' },
      description: 'Unique identifier of the card entry',
      example: '550e8400-e29b-41d4-a716-446655440000',
    }),
});

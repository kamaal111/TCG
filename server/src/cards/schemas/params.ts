import { z } from '@hono/zod-openapi';

import { CardIdSchema } from './fields.ts';

export const CardIdParamsSchema = z.object({
  cardId: CardIdSchema.openapi({
    description: 'Unique card entry identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
    param: { name: 'cardId', in: 'path' },
  }),
});

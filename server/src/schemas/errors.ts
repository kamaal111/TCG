import { z } from 'zod';

export const CardNotFoundErrorResponseSchema = z
  .object({
    message: z.string().meta({ description: 'Error message' }),
    code: z.literal('CARD_NOT_FOUND').meta({ description: 'Error code' }),
  })
  .meta({
    $id: 'CardNotFoundErrorResponse',
    title: 'Card Not Found Error Response',
    description: 'Error response for a missing or inaccessible owned card entry',
  });

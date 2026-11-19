import { z } from 'zod';

import { PrintingKeySchema } from '../../card-pricing/schemas/responses.ts';
import { base64UrlCursorPattern, paginationCursor } from '../../utils/pagination.ts';
import { decodeWishlistCursor } from '../utils/pagination.ts';

export const WishlistPrintingParamsSchema = z.object({ printingKey: PrintingKeySchema });

export const WishlistQuerySchema = z.object({
  query: z.string().trim().nonempty().max(200).optional().meta({
    description:
      'Case-insensitive literal substring in card name, English search alias, set name, or card number; omitted means all saved printings.',
    example: 'Luffy',
  }),
  cursor: paginationCursor(z.string().max(220).regex(base64UrlCursorPattern), decodeWishlistCursor).optional(),
});

import { z } from 'zod';

import { PrintingKeySchema } from '../../card-pricing/schemas/responses.ts';
import { base64UrlCursorPattern, paginationCursor } from '../../utils/pagination.ts';
import { decodeWishlistCursor } from '../utils/pagination.ts';

export const WishlistPrintingParamsSchema = z.object({ printingKey: PrintingKeySchema });

export const WishlistQuerySchema = z.object({
  cursor: paginationCursor(z.string().max(220).regex(base64UrlCursorPattern), decodeWishlistCursor).optional(),
});

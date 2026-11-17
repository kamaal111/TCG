import { z } from 'zod';

import { PrintingKeySchema } from '../../card-pricing/schemas/responses.ts';
import { decodeCursor, encodeCursor } from '../../utils/pagination.ts';

const CursorSchema = z.strictObject({
  savedAt: z.iso.datetime({ precision: 6 }),
  printingKey: PrintingKeySchema,
});

export type WishlistCursor = z.infer<typeof CursorSchema>;

export function encodeWishlistCursor(cursor: WishlistCursor): string {
  return encodeCursor(cursor);
}

export function decodeWishlistCursor(value: string): WishlistCursor | undefined {
  return decodeCursor(value, CursorSchema);
}

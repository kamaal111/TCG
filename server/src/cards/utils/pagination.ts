import z from 'zod';

import { UuidSchema } from '../../schemas/common.ts';
import { decodeCursor, encodeCursor } from '../../utils/pagination.ts';

type CursorValue = z.infer<typeof CursorValueSchema>;

const CursorValueSchema = z.strictObject({ createdAt: z.iso.datetime({ precision: 6 }), id: UuidSchema });

export function encodeCardCursor(value: CursorValue): string {
  return encodeCursor(value);
}

export function decodeCardCursor(value: string): CursorValue | undefined {
  return decodeCursor(value, CursorValueSchema);
}

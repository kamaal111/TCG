import buffer from 'node:buffer';

import z from 'zod';

import { UuidSchema } from '../../schemas/common.ts';

type CursorValue = z.infer<typeof CursorValueSchema>;

const CursorValueSchema = z.strictObject({ createdAt: z.iso.datetime({ precision: 6 }), id: UuidSchema });

export function encodeCardCursor(value: CursorValue): string {
  const jsonString = JSON.stringify(value);

  return buffer.Buffer.from(jsonString).toString('base64url');
}

export function decodeCardCursor(value: string): CursorValue | undefined {
  try {
    return CursorValueSchema.parse(JSON.parse(buffer.Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    return undefined;
  }
}

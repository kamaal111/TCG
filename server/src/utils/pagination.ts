import buffer from 'node:buffer';

import { z } from 'zod';

export const base64UrlCursorPattern = /^[A-Za-z0-9_-]+$/;

type CursorPayload = Readonly<Record<string, string | number>>;

export function encodeCursor(value: CursorPayload): string {
  return buffer.Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<Schema extends z.ZodType>(value: string, schema: Schema): z.output<Schema> | undefined {
  try {
    return schema.parse(JSON.parse(buffer.Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    return undefined;
  }
}

export function paginationCursor<Cursor>(input: z.ZodString, decode: (value: string) => Cursor | undefined) {
  return input.transform((value, context) => {
    const cursor = decode(value);

    if (cursor == null) {
      context.addIssue({ code: 'custom', message: 'Invalid pagination cursor' });

      return z.NEVER;
    }

    return cursor;
  });
}

export function cursorPage<Row>(rows: readonly Row[], limit: number, encodeNext: (last: Row) => string) {
  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    page,
    nextCursor: rows.length > limit && last != null ? encodeNext(last) : null,
  };
}

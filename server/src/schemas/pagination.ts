import { z } from 'zod';

const nextCursorSchema = z.string().nullable().meta({
  description: 'Opaque cursor for the next page; null when this is the final page',
  example: null,
});

export function paginatedResponseSchema<Entry extends z.ZodType>(entry: Entry) {
  return z.object({
    entries: z.array(entry),
    next_cursor: nextCursorSchema,
  });
}

export function serializePage<Entry>(entries: Entry[], nextCursor: string | null) {
  return { entries, next_cursor: nextCursor };
}

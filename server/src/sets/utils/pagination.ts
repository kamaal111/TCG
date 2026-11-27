import { InvalidValidation } from '@tcg/http/exceptions';
import { z } from 'zod';

import type { HonoContext } from '../../context.ts';
import { cursorPage, decodeCursor, encodeCursor } from '../../utils/pagination.ts';

const CursorSchema = z.object({ scope: z.string(), index: z.int().nonnegative() });

type SetCursor = z.infer<typeof CursorSchema>;

export function decodeSetCursor(value: string) {
  return decodeCursor(value, CursorSchema);
}

const PAGE_SIZE = 30;

export function setPage<Row>(
  c: HonoContext,
  scope: string,
  cursorValue: SetCursor | undefined,
  rows: readonly Row[],
  include: (row: Row) => boolean,
) {
  if (cursorValue != null && (cursorValue.scope !== scope || cursorValue.index >= rows.length)) {
    throw new InvalidValidation(c, [{ path: ['cursor'], message: 'Invalid pagination cursor' }]);
  }

  const candidates: { index: number; row: Row }[] = [];

  for (const [index, row] of rows.entries()) {
    if (index > (cursorValue?.index ?? -1) && include(row)) {
      candidates.push({ index, row });

      if (candidates.length > PAGE_SIZE) {
        break;
      }
    }
  }

  const { page, nextCursor } = cursorPage(candidates, PAGE_SIZE, ({ index }) => encodeCursor({ scope, index }));

  return { entries: page.map(({ row }) => row), nextCursor };
}

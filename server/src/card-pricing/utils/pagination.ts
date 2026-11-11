import buffer from 'node:buffer';
import crypto from 'node:crypto';

import { SCRYDEX_SEARCH_PAGE_SIZE } from '@tcg/scrydex';
import { z } from 'zod';

const SEARCH_PAGINATION_VERSION = 1;

const SearchCursorSchema = z.object({
  version: z.literal(SEARCH_PAGINATION_VERSION),
  offset: z.int().positive().multipleOf(SCRYDEX_SEARCH_PAGE_SIZE),
  identity: z.hash('sha256'),
});

type SearchCursor = z.infer<typeof SearchCursorSchema>;

export function searchPageKey(key: string, offset: number): string {
  return `page-v${SEARCH_PAGINATION_VERSION}|${offset}|${key}`;
}

export function searchCursorIdentity(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function encodeNextSearchCursor(key: string, offset: number): string {
  const cursor: SearchCursor = {
    version: SEARCH_PAGINATION_VERSION,
    offset: offset + SCRYDEX_SEARCH_PAGE_SIZE,
    identity: searchCursorIdentity(key),
  };

  return buffer.Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeSearchCursor(value: string): SearchCursor | undefined {
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined;
  }

  try {
    return SearchCursorSchema.parse(JSON.parse(buffer.Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    return undefined;
  }
}

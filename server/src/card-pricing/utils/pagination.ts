import { sha256Hex } from '@tcg/crypto/sha256';
import { SCRYDEX_SEARCH_PAGE_SIZE } from '@tcg/scrydex';
import { z } from 'zod';

import { base64UrlCursorPattern, decodeCursor, encodeCursor } from '../../utils/pagination.ts';

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
  return sha256Hex(key);
}

export function encodeNextSearchCursor(key: string, offset: number): string {
  const cursor: SearchCursor = {
    version: SEARCH_PAGINATION_VERSION,
    offset: offset + SCRYDEX_SEARCH_PAGE_SIZE,
    identity: searchCursorIdentity(key),
  };

  return encodeCursor(cursor);
}

export function decodeSearchCursor(value: string): SearchCursor | undefined {
  if (value.length > 256 || !base64UrlCursorPattern.test(value)) {
    return undefined;
  }

  return decodeCursor(value, SearchCursorSchema);
}

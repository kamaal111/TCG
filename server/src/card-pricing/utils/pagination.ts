import { sha256Hex } from '@tcg/crypto/sha256';
import { SCRYDEX_SEARCH_PAGE_SIZE } from '@tcg/scrydex';
import { z } from 'zod';

import { base64UrlCursorPattern, decodeCursor, encodeCursor } from '../../utils/pagination.ts';

const SEARCH_PAGINATION_VERSION = 1;
export const CATALOG_SEARCH_CURSOR_VERSION = 2;
export const CATALOG_PAGE_SIZE = 20;
const MAX_SEARCH_CURSOR_LENGTH = 256;

const SearchCursorSchema = z.object({
  version: z.literal(SEARCH_PAGINATION_VERSION),
  offset: z.int().positive().multipleOf(SCRYDEX_SEARCH_PAGE_SIZE),
  identity: z.hash('sha256'),
});

const CatalogSearchCursorSchema = z.object({
  version: z.literal(CATALOG_SEARCH_CURSOR_VERSION),
  offset: z.int().positive().multipleOf(CATALOG_PAGE_SIZE),
  identity: z.hash('sha256'),
  generation: z.uuid(),
});

const PricingSearchCursorSchema = z.discriminatedUnion('version', [SearchCursorSchema, CatalogSearchCursorSchema]);

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

export function encodeCatalogSearchCursor(key: string, generation: string, offset: number): string {
  return encodeCursor({
    version: CATALOG_SEARCH_CURSOR_VERSION,
    offset,
    identity: searchCursorIdentity(key),
    generation,
  });
}

export function decodeSearchCursor(value: string): z.infer<typeof PricingSearchCursorSchema> | undefined {
  if (value.length > MAX_SEARCH_CURSOR_LENGTH || !base64UrlCursorPattern.test(value)) {
    return undefined;
  }

  return decodeCursor(value, PricingSearchCursorSchema);
}

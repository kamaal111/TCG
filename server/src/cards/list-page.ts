import { z } from 'zod';

import { paginatedResponseSchema, serializePage } from '../schemas/pagination.ts';

export interface CardListChoices {
  availableSetNames: string[];
  availableIllustrators: string[];
}

export interface CardListPageInfo extends CardListChoices {
  nextCursor: string | null;
}

export function cardListPageSchema<Entry extends z.ZodType>(entry: Entry, setName: z.ZodType<string>) {
  return paginatedResponseSchema(entry).extend({
    available_set_names: z.array(setName),
    available_illustrators: z.array(z.string()),
  });
}

export function serializeCardListPage<Entry>(
  entries: Entry[],
  { availableSetNames, availableIllustrators, nextCursor }: CardListPageInfo,
) {
  return {
    ...serializePage(entries, nextCursor),
    available_set_names: availableSetNames,
    available_illustrators: availableIllustrators,
  };
}

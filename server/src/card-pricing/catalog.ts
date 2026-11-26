import { z } from 'zod';

import type { buildCatalogQuery } from './catalog-query.ts';
import type { CardLanguage } from './languages.ts';
import { CARD_GAME_MAP, type CardGame } from './types.ts';

export const CatalogPrintingSchema = z.object({
  game: z.enum(CARD_GAME_MAP),
  pricingId: z.string().nonempty(),
  providerId: z.string().nonempty(),
  language: z.string().nonempty(),
  names: z.array(z.string()),
  nameTokens: z.array(z.string()),
  setTokens: z.array(z.string()),
  setIds: z.array(z.string()),
  setKey: z.string(),
  setName: z.string().nullish(),
  primarySet: z.boolean(),
  collectorNumber: z.string().nonempty(),
  printedNumber: z.string().nonempty(),
});

export type CatalogPrinting = z.infer<typeof CatalogPrintingSchema>;

export interface CatalogSearch {
  game: CardGame;
  query: ReturnType<typeof buildCatalogQuery>;
  languages: readonly CardLanguage[];
  offset: number;
}

export interface CardCatalog {
  readonly version: string;
  search(search: CatalogSearch): {
    printings: (Pick<CatalogPrinting, 'pricingId' | 'providerId'> & { setName: string | null })[];
    nextOffset: number | undefined;
  };
}

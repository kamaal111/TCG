import type { buildCatalogQuery } from './catalog-query.ts';
import type { CardLanguage } from './languages.ts';
import type { CardGame } from './types.ts';

export interface CatalogPrintingRow {
  readonly providerId: string;
  readonly pricingId: string;
  readonly language: string;
  readonly names: string[];
  readonly nameTokens: string[];
  readonly setTokens: string[];
  readonly setIds: string[];
  readonly setKey: string;
  readonly setName: string | undefined;
  readonly primarySet: boolean;
  readonly collectorNumber: string;
  readonly printedNumber: string;
}

export interface CatalogGeneration {
  readonly id: string;
  readonly publishedAt: Date;
  readonly printingCount: number;
}

export interface CatalogSearchPage {
  readonly printings: { readonly pricingId: string; readonly providerId: string; readonly setName: string | null }[];
  readonly nextOffset: number | undefined;
}

export interface CardCatalogRepository {
  generation(game: CardGame, id: string | undefined): Promise<CatalogGeneration | undefined>;
  withBuildLock(game: CardGame, operation: () => Promise<void>): Promise<boolean>;
  publish(game: CardGame, printings: readonly CatalogPrintingRow[]): Promise<void>;
  search(
    generation: string,
    query: ReturnType<typeof buildCatalogQuery>,
    languages: readonly CardLanguage[],
    offset: number,
  ): Promise<CatalogSearchPage>;
}

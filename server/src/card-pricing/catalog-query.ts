import { CARD_GAME_MAP, type CardGame } from './types.ts';
import type { GetRecordValues } from '../utils/type-utils.ts';
import {
  normalizeCollectorNumber,
  ONE_PIECE_CARD_NUMBER,
  pokemonPrintedNumber,
  pokemonSetAndNumber,
} from './utils/identifiers.ts';
import { normalizeCardNumber } from './utils/query.ts';

export function catalogTerms(value: string): string[] {
  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\p{Script=Latin}/gu, letter => letter.normalize('NFD').replace(/\p{M}/gu, ''))
    .replace(/['’]/g, '');

  return normalized.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
}

export const CATALOG_IDENTIFIER_FIELD_MAP = {
  PROVIDER: 'provider',
  PRINTED: 'printed',
  COLLECTOR: 'collector',
} as const;

export interface CatalogIdentifier {
  readonly field: GetRecordValues<typeof CATALOG_IDENTIFIER_FIELD_MAP>;
  readonly value: string;
  readonly sets: readonly string[];
}

export function buildCatalogQuery(game: CardGame, query: string) {
  const words = query.trim().split(/\s+/);
  const last = normalizeCardNumber(words.at(-1) ?? '');
  const terms = catalogTerms(query);
  const identifiers: CatalogIdentifier[] = [];
  let requireIdentifier = false;
  let identifierTerms = catalogTerms(words.slice(0, -1).join(' '));

  if (game === CARD_GAME_MAP.ONE_PIECE && ONE_PIECE_CARD_NUMBER.test(last)) {
    identifiers.push({ field: CATALOG_IDENTIFIER_FIELD_MAP.PROVIDER, value: last, sets: [] });
    requireIdentifier = true;
  }

  if (game === CARD_GAME_MAP.POKEMON) {
    const printed = pokemonPrintedNumber(last);
    const sets = pokemonSetAndNumber(words)?.expansionIds ?? [];

    if (sets.length > 0) {
      identifierTerms = [];
    }

    if (printed != null) {
      identifiers.push({ field: CATALOG_IDENTIFIER_FIELD_MAP.PRINTED, value: printed.number, sets });

      const promoSet = printed.promo?.expansionId;

      if (printed.promo != null && promoSet != null && (sets.length === 0 || sets.includes(promoSet))) {
        identifiers.push({
          field: CATALOG_IDENTIFIER_FIELD_MAP.COLLECTOR,
          value: normalizeCollectorNumber(printed.promo.collectorNumber),
          sets: [promoSet],
        });
      }
    } else if (/^[A-Z]*\d+[A-Z]?$/i.test(last)) {
      identifiers.push({ field: CATALOG_IDENTIFIER_FIELD_MAP.COLLECTOR, value: normalizeCollectorNumber(last), sets });
    }

    requireIdentifier = printed != null || sets.length > 0;
  }

  return { terms, identifiers, identifierTerms, requireIdentifier };
}

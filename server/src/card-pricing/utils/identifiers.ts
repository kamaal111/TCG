import promoExpansionBySuffix from './promo-expansion-by-suffix.json' with { type: 'json' };

export const ONE_PIECE_CARD_NUMBER = /^(?:[A-Z]{2}\d{2}|P)-\d{3}$/i;

const POKEMON_EXPANSION_ID = /^(?:[a-z]{1,4}\d[a-z0-9]*|mep)(?:_[a-z]{2})?$/i;

const NUMERIC_CARD_NUMBER = /^\d+$/;

const POKEMON_SET_AND_NUMBER_TERM_COUNT = 2;

const PRINTED_CARD_NUMBER = /^[A-Z]*\d+\/[A-Z]*\d+$/i;

const SET_SUFFIX_CARD_NUMBER = /^([A-Z]*\d+)\/([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)$/;

const PROMO_EXPANSION_BY_SUFFIX = new Map(Object.entries(promoExpansionBySuffix));

const PROMO_EXPANSION_IDS = new Set(PROMO_EXPANSION_BY_SUFFIX.values());

export function normalizeCollectorNumber(number: string): string {
  return NUMERIC_CARD_NUMBER.test(number) ? number.replace(/^0+(?=\d)/, '') : number;
}

export function pokemonPrintedNumber(value: string) {
  const number = value.toUpperCase();

  if (PRINTED_CARD_NUMBER.test(number)) {
    return { number };
  }

  const [, collectorNumber, suffix] = SET_SUFFIX_CARD_NUMBER.exec(number) ?? [];

  if (collectorNumber != null && suffix != null) {
    return { number, promo: { collectorNumber, expansionId: PROMO_EXPANSION_BY_SUFFIX.get(suffix) } };
  }

  return undefined;
}

export function pokemonSetAndNumber(terms: readonly string[]) {
  if (terms.length !== POKEMON_SET_AND_NUMBER_TERM_COUNT) {
    return undefined;
  }

  const [first, number] = terms;

  if (first == null || number == null) {
    return undefined;
  }

  const expansion = first.toLowerCase();
  const printed = pokemonPrintedNumber(number);

  const expansionKnown =
    POKEMON_EXPANSION_ID.test(expansion) || (printed?.promo != null && PROMO_EXPANSION_IDS.has(expansion));

  if (!expansionKnown || (printed == null && !NUMERIC_CARD_NUMBER.test(number))) {
    return undefined;
  }

  const expansionIds = /_[a-z]{2}$/.test(expansion) ? [expansion] : [expansion, expansion + '_ja'];

  return { expansionIds, number };
}

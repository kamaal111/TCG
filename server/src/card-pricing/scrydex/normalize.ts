import type { ScrydexRawCard, ScrydexRawPrice } from '@tcg/scrydex';
import z from 'zod';

import { CurrencySchema } from '../../forex/currencies.ts';
import type { PricingSearchResult } from '../client.ts';
import { ONE_PIECE_VARIANT_SEPARATOR } from '../constants.ts';
import type {
  CardGame,
  Currency,
  NormalizedPricing,
  NormalizedPricingCard,
  PriceMovement,
  PricingCardRecord,
} from '../types.ts';
import { CARD_GAME_MAP } from '../types.ts';
import { IllustratorNameSchema } from '../utils/illustrator.ts';

const RequiredCardSchema = z.object({
  id: z.coerce.string().nonempty(),
  name: z.string().nonempty(),
});

const NonEmptyStringSchema = z.string().trim().nonempty();

const FiniteNumberSchema = z.number();

const POKEMON_BASE_VARIANT_NAMES = ['normal', 'unlimitednormal', 'holofoil', 'unlimitedholofoil'];

export interface ScrydexNormalizationResult {
  card: NormalizedPricingCard;
  hasBaseVariant: boolean;
}

type RawVariant = NonNullable<ScrydexRawCard['variants']>[number];

export function normalizeScrydexCard(game: CardGame, raw: ScrydexRawCard): ScrydexNormalizationResult | null {
  const baseVariant =
    game === CARD_GAME_MAP.ONE_PIECE
      ? (findVariant(raw, 'normal') ?? findVariant(raw, 'foil'))
      : raw.variants?.find(variant => {
          const name = stringValue(variant.name)?.toLowerCase();

          return name != null && POKEMON_BASE_VARIANT_NAMES.includes(name);
        });

  return normalizePrinting(game, raw, baseVariant);
}

export function normalizeScrydexSearch(
  game: CardGame,
  rawCards: readonly ScrydexRawCard[],
  {
    providerResultCount,
    hasMore,
    rejectedCount,
  }: Pick<PricingSearchResult, 'providerResultCount' | 'hasMore' | 'rejectedCount'>,
): PricingSearchResult {
  const records: PricingCardRecord[] = [];
  let normalizationRejections = 0;
  let missingBaseVariantCount = 0;

  for (const raw of rawCards) {
    const printings = normalizeScrydexSearchCard(game, raw);
    const base = printings[0];

    if (base == null) {
      normalizationRejections += 1;
      continue;
    }

    if (!base.hasBaseVariant) {
      missingBaseVariantCount += 1;
    }

    for (const { card } of printings) {
      records.push({ card, raw });
    }
  }

  return {
    records,
    providerResultCount,
    hasMore,
    rejectedCount: rejectedCount + normalizationRejections,
    missingBaseVariantCount,
  };
}

function normalizeScrydexSearchCard(game: CardGame, raw: ScrydexRawCard): ScrydexNormalizationResult[] {
  const base = normalizeScrydexCard(game, raw);

  if (base == null) {
    return [];
  }

  if (game !== CARD_GAME_MAP.ONE_PIECE) {
    return [base];
  }

  const printings = [base];
  const names = new Set([base.card.pricing.variantName?.toLowerCase()]);

  for (const variant of raw.variants ?? []) {
    const name = stringValue(variant.name)?.toLowerCase();

    if (name == null || names.has(name)) {
      continue;
    }

    const printing = normalizePrinting(game, raw, variant, name);

    if (printing != null) {
      printings.push(printing);
    }

    names.add(name);
  }

  return printings;
}

export function splitScrydexPricingId(game: CardGame, id: string): { providerId: string; variantName?: string } {
  const separator = game === CARD_GAME_MAP.ONE_PIECE ? id.indexOf(ONE_PIECE_VARIANT_SEPARATOR) : -1;

  return separator < 0
    ? { providerId: id }
    : { providerId: id.slice(0, separator), variantName: id.slice(separator + ONE_PIECE_VARIANT_SEPARATOR.length) };
}

export function normalizeScrydexLookup(
  game: CardGame,
  raw: ScrydexRawCard,
  variantName: string | undefined,
): ScrydexNormalizationResult | null {
  if (variantName == null) {
    return normalizeScrydexCard(game, raw);
  }

  const variant = findVariant(raw, variantName);

  return variant != null ? normalizePrinting(game, raw, variant, variantName) : null;
}

function findVariant(raw: ScrydexRawCard, name: string): RawVariant | undefined {
  return raw.variants?.find(variant => stringValue(variant.name)?.toLowerCase() === name);
}

function normalizePrinting(
  game: CardGame,
  raw: ScrydexRawCard,
  variant: RawVariant | undefined,
  variantKey?: string,
): ScrydexNormalizationResult | null {
  const parsed = RequiredCardSchema.safeParse(raw);
  const cardNumber = stringValue(raw.printed_number) ?? stringValue(raw.number);

  if (!parsed.success || cardNumber == null) {
    return null;
  }

  const rawPrice = variant?.prices?.find(price => price.condition === 'NM' && price.type === 'raw');
  const market = normalizeRawPrice(rawPrice);
  const image = imageURL(variant?.images) ?? (variantKey == null ? imageURL(raw.images) : undefined);
  const rarity = stringValue(raw.rarity);
  const pricing: NormalizedPricingCard['pricing'] = {};

  const illustrator = IllustratorNameSchema.safeParse(
    game === CARD_GAME_MAP.POKEMON ? raw.artist : (variant?.artist ?? (variantKey == null ? raw.artist : undefined)),
  );

  const variantName = game === CARD_GAME_MAP.ONE_PIECE ? stringValue(variant?.name) : undefined;

  if (variantName != null) {
    pricing.variantName = variantName;
  }

  if (illustrator.success) {
    pricing.illustrator = illustrator.data;
  }

  if (raw.expansion?.name != null) {
    pricing.setName = raw.expansion.name;
  }

  if (market != null) {
    pricing.market = market;
  }

  if (image != null) {
    pricing.image = image;
  }

  if (rarity != null) {
    pricing.rarity = rarity;
  }

  return {
    card: {
      id: variantKey == null ? parsed.data.id : parsed.data.id + ONE_PIECE_VARIANT_SEPARATOR + variantKey,
      name: parsed.data.name,
      cardNumber,
      pricing,
    },
    hasBaseVariant: variant != null,
  };
}

function normalizeRawPrice(raw: ScrydexRawPrice | undefined): NormalizedPricing['market'] {
  if (raw == null) {
    return undefined;
  }

  const currency = normalizeCurrency(raw.currency);

  if (currency == null) {
    return undefined;
  }

  const low = finiteNonnegativeNumber(raw.low);
  const market = finiteNonnegativeNumber(raw.market);
  const trend7d = normalizeMovement(raw.trends?.days_7);
  const trend30d = normalizeMovement(raw.trends?.days_30);

  if (low == null && market == null && trend7d == null && trend30d == null) {
    return undefined;
  }

  const normalized: NonNullable<NormalizedPricing['market']> = {
    condition: 'near_mint',
    currency,
  };

  if (low != null) {
    normalized.low = low;
  }

  if (market != null) {
    normalized.market = market;
  }

  if (trend7d != null) {
    normalized.trend7d = trend7d;
  }

  if (trend30d != null) {
    normalized.trend30d = trend30d;
  }

  return normalized;
}

function normalizeMovement(
  raw: { price_change?: unknown; percent_change?: unknown } | undefined,
): PriceMovement | undefined {
  const priceChange = finiteNumber(raw?.price_change);
  const percentChange = finiteNumber(raw?.percent_change);

  return priceChange != null && percentChange != null ? { priceChange, percentChange } : undefined;
}

function normalizeCurrency(value: ScrydexRawPrice['currency']): Currency | undefined {
  const parsed = CurrencySchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

function imageURL(images: ScrydexRawCard['images']): string | undefined {
  const front = images?.find(image => image.type === 'front') ?? images?.[0];

  return stringValue(front?.large) ?? stringValue(front?.medium) ?? stringValue(front?.small);
}

function stringValue(value: ScrydexRawCard['name']): string | undefined {
  const parsed = NonEmptyStringSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

function finiteNumber(value: ScrydexRawPrice['low']): number | undefined {
  const parsed = FiniteNumberSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

function finiteNonnegativeNumber(value: ScrydexRawPrice['low']): number | undefined {
  const number = finiteNumber(value);

  return number != null && number >= 0 ? number : undefined;
}

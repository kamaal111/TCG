import z from 'zod';

import type { CardGame, Currency, NormalizedPricing, NormalizedPricingCard, PriceMovement } from '../types.ts';
import { CARD_GAME_MAP, CURRENCIES } from '../types.ts';
import type { ScrydexRawCard, ScrydexRawPrice } from './types.ts';

const RequiredCardSchema = z.object({
  id: z.coerce.string().min(1),
  name: z.string().min(1),
});

const CurrencySchema = z.enum(Object.values(CURRENCIES));

const NonEmptyStringSchema = z.string().trim().min(1);

const FiniteNumberSchema = z.number();

const BASE_VARIANT_NAMES = {
  [CARD_GAME_MAP.ONE_PIECE]: ['normal'],
  [CARD_GAME_MAP.POKEMON]: ['normal', 'unlimitednormal', 'holofoil', 'unlimitedholofoil'],
} satisfies Record<CardGame, readonly string[]>;

export interface ScrydexNormalizationResult {
  card: NormalizedPricingCard;
  hasBaseVariant: boolean;
}

export function normalizeScrydexCard(game: CardGame, raw: ScrydexRawCard): ScrydexNormalizationResult | null {
  const parsed = RequiredCardSchema.safeParse(raw);
  const cardNumber = stringValue(raw.printed_number) ?? stringValue(raw.number);

  if (!parsed.success || cardNumber == null) {
    return null;
  }

  const baseVariant = raw.variants?.find(variant => {
    const name = stringValue(variant.name)?.toLowerCase();

    return name != null && BASE_VARIANT_NAMES[game].includes(name);
  });

  const rawPrice = baseVariant?.prices?.find(price => price.condition === 'NM' && price.type === 'raw');
  const market = normalizeRawPrice(rawPrice);
  const image = imageURL(baseVariant?.images) ?? imageURL(raw.images);
  const rarity = stringValue(raw.rarity);
  const pricing: NormalizedPricingCard['pricing'] = {};

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
      id: parsed.data.id,
      name: parsed.data.name,
      cardNumber,
      pricing,
    },
    hasBaseVariant: baseVariant != null,
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

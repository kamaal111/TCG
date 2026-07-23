import z from 'zod';

import type { CardGame, Currency, NormalizedPricingCard, PriceMovement } from '../types.ts';
import { CARD_GAME_MAP, CURRENCIES } from '../types.ts';
import type { ScrydexRawCard, ScrydexRawPrice } from './types.ts';

const RequiredCardSchema = z.object({
  id: z.coerce.string().min(1),
  name: z.string().min(1),
});

const BASE_VARIANT_NAMES: Record<CardGame, readonly string[]> = {
  [CARD_GAME_MAP.ONE_PIECE]: ['normal'],
  [CARD_GAME_MAP.POKEMON]: ['normal', 'unlimitednormal', 'holofoil', 'unlimitedholofoil'],
};

export interface ScrydexNormalizationResult {
  card: NormalizedPricingCard;
  hasBaseVariant: boolean;
}

export function normalizeScrydexCard(game: CardGame, raw: ScrydexRawCard): ScrydexNormalizationResult | null {
  const parsed = RequiredCardSchema.safeParse(raw);
  const cardNumber = stringValue(raw.printed_number) ?? stringValue(raw.number);
  if (!parsed.success || cardNumber == null) return null;

  const baseVariant = raw.variants?.find(variant => {
    const name = stringValue(variant.name)?.toLowerCase();
    return name != null && BASE_VARIANT_NAMES[game].includes(name);
  });
  const rawPrice = baseVariant?.prices?.find(price => price.condition === 'NM' && price.type === 'raw');
  const market = normalizeRawPrice(rawPrice);
  const image = imageURL(baseVariant?.images) ?? imageURL(raw.images);
  const rarity = stringValue(raw.rarity);
  const pricing: NormalizedPricingCard['pricing'] = {};
  if (market != null) pricing.market = market;
  if (image != null) pricing.image = image;
  if (rarity != null) pricing.rarity = rarity;

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

function normalizeRawPrice(raw: ScrydexRawPrice | undefined) {
  if (raw == null) return undefined;
  const currency = normalizeCurrency(raw.currency);
  if (currency == null) return undefined;

  const low = finiteNonnegativeNumber(raw.low);
  const market = finiteNonnegativeNumber(raw.market);
  const trend7d = normalizeMovement(raw.trends?.days_7);
  const trend30d = normalizeMovement(raw.trends?.days_30);
  if (low == null && market == null && trend7d == null && trend30d == null) return undefined;

  return {
    condition: 'near_mint' as const,
    currency,
    ...(low == null ? {} : { low }),
    ...(market == null ? {} : { market }),
    ...(trend7d == null ? {} : { trend7d }),
    ...(trend30d == null ? {} : { trend30d }),
  };
}

function normalizeMovement(
  raw: { price_change?: unknown; percent_change?: unknown } | undefined,
): PriceMovement | undefined {
  const priceChange = finiteNumber(raw?.price_change);
  const percentChange = finiteNumber(raw?.percent_change);
  return priceChange == null || percentChange == null ? undefined : { priceChange, percentChange };
}

function normalizeCurrency(value: unknown): Currency | undefined {
  return typeof value === 'string' && Object.values(CURRENCIES).includes(value as Currency)
    ? (value as Currency)
    : undefined;
}

function imageURL(images: ScrydexRawCard['images']): string | undefined {
  const front = images?.find(image => image.type === 'front') ?? images?.[0];
  return stringValue(front?.large) ?? stringValue(front?.medium) ?? stringValue(front?.small);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finiteNonnegativeNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number != null && number >= 0 ? number : undefined;
}

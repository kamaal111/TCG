import { z } from 'zod';

import type { NormalizedPricing, NormalizedTCGGOCard, TCGGORawCard, TCGGORawPriceBlock } from './types.ts';

const RequiredCardSchema = z.object({
  id: z.coerce.string().min(1),
  name: z.string().min(1),
  card_number: z.coerce.string().min(1),
});

export function normalizeTCGGOCard(raw: TCGGORawCard): NormalizedTCGGOCard | null {
  const parsed = RequiredCardSchema.safeParse(raw);
  if (!parsed.success) return null;

  const cardmarket = normalizeCardmarket(raw.prices?.cardmarket);
  const tcgplayer = normalizeTCGPlayer(raw.prices?.tcg_player ?? raw.prices?.tcgplayer);

  return {
    id: parsed.data.id,
    name: parsed.data.name,
    cardNumber: parsed.data.card_number,
    pricing: {
      ...(cardmarket == null ? {} : { cardmarket }),
      ...(tcgplayer == null ? {} : { tcgplayer }),
      ...(raw.prices?.ebay == null ? {} : { ebay: raw.prices.ebay }),
      ...(typeof raw.image === 'string' ? { image: raw.image } : {}),
      ...(typeof raw.rarity === 'string' ? { rarity: raw.rarity } : {}),
    },
  };
}

function normalizeCardmarket(block: TCGGORawPriceBlock | undefined): NormalizedPricing['cardmarket'] {
  const currency = normalizeCurrency(block?.currency);
  if (block == null || currency == null) return undefined;

  return {
    currency,
    ...optionalValue('lowestNearMint', finiteNumber(block.lowest_near_mint)),
    ...optionalValue('average7d', finiteNumber(block['7d_average'])),
    ...optionalValue('average30d', finiteNumber(block['30d_average'])),
    ...(block.graded == null ? {} : { graded: block.graded }),
  };
}

function normalizeTCGPlayer(block: TCGGORawPriceBlock | undefined): NormalizedPricing['tcgplayer'] {
  const currency = normalizeCurrency(block?.currency);
  if (block == null || currency == null) return undefined;

  return {
    currency,
    ...optionalValue('marketPrice', finiteNumber(block.market_price)),
    ...optionalValue('midPrice', finiteNumber(block.mid_price)),
  };
}

function normalizeCurrency(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toUpperCase() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalValue<Key extends string>(key: Key, value: number | undefined) {
  return value == null ? {} : { [key]: value };
}

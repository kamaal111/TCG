import { z } from 'zod';

import { CARD_GAME_MAP, type CardGame, isScrydexPricingSource, type PricingSource } from '../types.ts';

const EnglishSearchAliasResponseSchema = z.object({
  translation: z.object({ en: z.object({ name: z.string().trim().nonempty() }) }),
});

export function readEnglishSearchAlias({
  game,
  pricingSource,
  raw,
}: Readonly<{ game: CardGame; pricingSource: PricingSource; raw: unknown }>): string | undefined {
  if (game !== CARD_GAME_MAP.POKEMON || !isScrydexPricingSource(pricingSource)) {
    return undefined;
  }

  return EnglishSearchAliasResponseSchema.safeParse(raw).data?.translation.en.name;
}

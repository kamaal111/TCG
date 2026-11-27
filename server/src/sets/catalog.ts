import { z } from 'zod';

import { CARD_GAME_MAP, type CardGame } from '../card-pricing/types.ts';
import { normalizeCollectorNumber } from '../card-pricing/utils/identifiers.ts';
import { normalizeCardNumber } from '../card-pricing/utils/query.ts';

const ImageURLSchema = z.url().refine(value => {
  const url = new URL(value);

  return url.protocol === 'https:' && url.hostname === 'images.scrydex.com' && url.port === '';
});

const GameSchema = z.enum(CARD_GAME_MAP);

export const SetExpansionSchema = z.object({
  game: GameSchema,
  id: z.string().nonempty(),
  name: z.string().nonempty(),
  aliases: z.array(z.string()),
  code: z.string().nullish(),
  language: z.string().nullish(),
  releaseDate: z.string().nullish(),
  logo: ImageURLSchema.nullish(),
  symbol: ImageURLSchema.nullish(),
});

export const SetPrintingSchema = z.object({
  game: GameSchema,
  setId: z.string().nonempty(),
  pricingId: z.string().nonempty(),
  number: z.string().nonempty(),
  name: z.string().nonempty(),
  printedNumber: z.string().nonempty(),
  image: ImageURLSchema.nullish(),
});

export type SetExpansion = z.infer<typeof SetExpansionSchema>;

export type SetPrinting = z.infer<typeof SetPrintingSchema>;

export interface SetInventory {
  expansions: readonly SetExpansion[];
  printings: readonly SetPrinting[];
}

export function setCollectorNumber(game: CardGame, value: string) {
  const printed = normalizeCardNumber(value);

  return game === CARD_GAME_MAP.ONE_PIECE ? printed : normalizeCollectorNumber(printed.split('/')[0] ?? printed);
}

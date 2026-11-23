import { z } from 'zod';

import { PricedCardSchema, PrintingKeySchema } from '../../card-pricing/schemas/responses.ts';
import { cardListPageSchema } from '../../cards/list-page.ts';

export const WishlistCardSchema = PricedCardSchema.pick({
  id: true,
  game: true,
  name: true,
  set_name: true,
  card_number: true,
  variant_name: true,
  illustrator: true,
  english_search_alias: true,
  rarity: true,
  image_url: true,
  priced_on: true,
  fetched_at: true,
})
  .extend({ printing_key: PrintingKeySchema })
  .meta({ $id: 'WishlistCard' });

export const WishlistPageSchema = cardListPageSchema(PricedCardSchema, z.string()).partial({
  available_set_names: true,
  available_illustrators: true,
});

export type WishlistCard = z.infer<typeof WishlistCardSchema>;

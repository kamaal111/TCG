import { z } from 'zod';

import { PricedCardSchema, PrintingKeySchema } from '../../card-pricing/schemas/responses.ts';

export const WishlistCardSchema = PricedCardSchema.pick({
  id: true,
  game: true,
  name: true,
  set_name: true,
  card_number: true,
  variant_name: true,
  illustrator: true,
  rarity: true,
  image_url: true,
  priced_on: true,
  fetched_at: true,
})
  .extend({ printing_key: PrintingKeySchema })
  .meta({ $id: 'WishlistCard' });

export const WishlistPageSchema = z.object({
  entries: z.array(PricedCardSchema),
  next_cursor: z.string().nullable(),
});

export type WishlistCard = z.infer<typeof WishlistCardSchema>;

import { z } from 'zod';

import { CardCoreFieldsSchema } from './fields.ts';
import { CARD_GAME_MAP } from '../../card-pricing/types.ts';
import { CARD_GAMES } from '../types.ts';

const SetNameFilterSchema = CardCoreFieldsSchema.shape.set_name.nonempty();

export const CardListFiltersSchema = z.object({
  illustrator: z
    .preprocess(
      value => {
        const parsed = z.string().safeParse(value);

        return parsed.success ? [parsed.data] : value;
      },
      z.array(z.string().trim().nonempty().max(200)).optional(),
    )
    .meta({
      type: 'array',
      items: { type: 'string' },
      description: 'Exact illustrator names; repeat for multiple selections. Pokémon only.',
    }),
  game: z.enum(CARD_GAMES).optional().meta({ description: 'Optional game filter', example: CARD_GAME_MAP.ONE_PIECE }),
  set_name: z
    .preprocess(value => {
      const single = SetNameFilterSchema.safeParse(value);

      return single.success ? [single.data] : value;
    }, z.array(SetNameFilterSchema).optional())
    .meta({
      type: 'array',
      items: z.toJSONSchema(SetNameFilterSchema),
      description: 'Optional exact set names. Repeat set_name for multiple sets; omitted means all sets.',
      example: ['Base Set', 'Crown Zenith'],
    }),
});

export function validateCardListFilters(
  { game, illustrator }: z.infer<typeof CardListFiltersSchema>,
  ctx: z.RefinementCtx,
) {
  if (game === CARD_GAME_MAP.ONE_PIECE && illustrator != null && illustrator.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['illustrator'],
      message: 'Illustrator filtering is only supported for Pokémon',
    });
  }
}

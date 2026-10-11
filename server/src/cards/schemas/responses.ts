import { z } from 'zod';

import { CardPurchaseSchema, CardCoreFieldsSchema, CardIdSchema } from './fields.ts';
import { OwnedCardPriceSchema } from '../../card-pricing/schemas/responses.ts';
import { ApiCommonDatetime } from '../../schemas/common.ts';

export const CardSchema = CardCoreFieldsSchema.extend({
  id: CardIdSchema.meta({
    description: 'Unique card entry identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
  notes: z.string().max(2000).nullable().meta({ description: 'Optional notes', example: 'Alternate art' }),
  purchases: z.array(CardPurchaseSchema),
  purchase_price_change_percent: z.number().nullable(),
  created_at: ApiCommonDatetime.meta({
    description: 'Creation timestamp',
    example: '2026-07-20T10:30:00.000Z',
  }),
  updated_at: ApiCommonDatetime.meta({
    description: 'Last update timestamp',
    example: '2026-07-20T10:30:00.000Z',
  }),
}).meta({
  $id: 'Card',
  title: 'Card',
  description: 'An owned trading card entry',
  example: {
    id: '550e8400-e29b-41d4-a716-446655440000',
    game: 'one_piece',
    name: 'Monkey D. Luffy',
    set_name: 'Romance Dawn',
    card_number: 'OP01-003',
    notes: null,
    purchases: [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        condition: 'near_mint',
        quantity: 2,
        purchase_price: null,
        currency: null,
        automatic_price_date: null,
      },
    ],
    purchase_price_change_percent: null,
    created_at: '2026-07-20T10:30:00.000Z',
    updated_at: '2026-07-20T10:30:00.000Z',
  },
});

/**
 * An owned card together with its price.
 *
 * Written as an intersection rather than an extension so the document composes it from the `Card`
 * component instead of repeating every field.
 */
export const CardWithPriceSchema = z.intersection(CardSchema, z.object({ price: OwnedCardPriceSchema })).meta({
  $id: 'CardWithPrice',
  title: 'Card With Price',
  description: 'An owned trading card entry with its freshly refreshed price',
  example: {
    id: '550e8400-e29b-41d4-a716-446655440000',
    game: 'one_piece',
    name: 'Monkey D. Luffy',
    set_name: 'Romance Dawn',
    card_number: 'OP01-003',
    notes: null,
    purchases: [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        condition: 'near_mint',
        quantity: 2,
        purchase_price: null,
        currency: null,
        automatic_price_date: null,
      },
    ],
    purchase_price_change_percent: null,
    created_at: '2026-07-20T10:30:00.000Z',
    updated_at: '2026-07-20T10:30:00.000Z',
    price: { card_id: '550e8400-e29b-41d4-a716-446655440000', status: 'priced' },
  },
});

const NextCardsCursorSchema = z.string().nullable().meta({
  description: 'Opaque cursor for the next page; null when this is the final page',
  example: null,
});

export const CardsListResponseSchema = z
  .object({
    cards: z.array(CardWithPriceSchema).meta({ description: 'Owned card entries with daily pricing, newest first' }),
    next_cursor: NextCardsCursorSchema,
    available_set_names: z.array(CardCoreFieldsSchema.shape.set_name).meta({
      description: 'Distinct owned set names in alphabetical order, scoped by game but independent of the set filter',
    }),
  })
  .meta({
    $id: 'CardsListResponse',
    title: 'Cards List Response',
    description: "One page of the authenticated user's card collection with complete game-scoped set choices",
    example: { cards: [], available_set_names: [], next_cursor: null },
  });

export type CardResponse = z.infer<typeof CardSchema>;

export type CardWithPriceResponse = z.infer<typeof CardWithPriceSchema>;

export type CardsListResponse = z.infer<typeof CardsListResponseSchema>;

export const DeleteCardsResponseSchema = z
  .object({
    deleted_ids: z.array(CardIdSchema),
    not_found_ids: z.array(CardIdSchema),
  })
  .meta({ $id: 'DeleteCardsResponse', title: 'Delete Cards Response' });

export type DeleteCardsResponse = z.infer<typeof DeleteCardsResponseSchema>;

export const ExportCardsResponseSchema = z
  .object({
    cards: z.array(CardSchema).meta({ description: 'One page of owned cards without refreshed market pricing' }),
    next_cursor: NextCardsCursorSchema,
  })
  .meta({
    $id: 'ExportCardsResponse',
    title: 'Export Cards Response',
    description: "One page of the authenticated user's owned cards and purchase history",
    example: {
      next_cursor: null,
      cards: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          game: 'one_piece',
          name: 'Monkey D. Luffy',
          set_name: 'Romance Dawn',
          card_number: 'OP01-003',
          notes: 'Alternate art',
          purchases: [
            {
              id: '550e8400-e29b-41d4-a716-446655440001',
              condition: 'near_mint',
              quantity: 2,
              purchase_price: '2.500000',
              currency: 'USD',
              automatic_price_date: '2026-07-20',
            },
          ],
          purchase_price_change_percent: null,
          created_at: '2026-07-20T10:30:00.000Z',
          updated_at: '2026-07-20T10:30:00.000Z',
        },
      ],
    },
  });

export const ImportCardsResponseSchema = z
  .object({
    imported_count: z.number().int().nonnegative().meta({ description: 'Number of newly imported cards', example: 1 }),
    updated_count: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: 'Number of changed owned cards replaced, including their complete purchases', example: 1 }),
    skipped_count: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: 'Number of unchanged cards or repeated input identifiers skipped', example: 0 }),
  })
  .meta({
    $id: 'ImportCardsResponse',
    title: 'Import Cards Response',
    description: 'Counts of new, replaced, and unchanged cards',
    example: { imported_count: 1, updated_count: 1, skipped_count: 0 },
  });

export type ImportCardsResponse = z.infer<typeof ImportCardsResponseSchema>;

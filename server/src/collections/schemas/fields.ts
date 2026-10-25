import { z } from 'zod';

import { BINDER_LAYOUT_EXAMPLE, BINDER_PAGE_EXAMPLE, BINDER_SLOT_EXAMPLE } from './examples.ts';
import { CARD_CONDITIONS, MAX_COPIES_PER_CONDITION } from '../../cards/types.ts';
import { UuidSchema } from '../../schemas/common.ts';
import { MAX_BINDER_DIMENSION } from '../constants.ts';

const DimensionSchema = z.number().int().positive().max(MAX_BINDER_DIMENSION);

const SlotSchema = z
  .object({
    row: DimensionSchema,
    column: DimensionSchema,
    card_id: UuidSchema,
    quantity: z
      .number()
      .int()
      .positive()
      .max(CARD_CONDITIONS.length * MAX_COPIES_PER_CONDITION),
  })
  .meta({
    $id: 'BinderSlot',
    title: 'Binder Slot',
    description: 'Copies of one owned card entry placed at a one-based row and column within a page',
    example: BINDER_SLOT_EXAMPLE,
  });

const PageSchema = z.object({ id: UuidSchema, slots: z.array(SlotSchema) }).meta({
  $id: 'BinderPage',
  title: 'Binder Page',
  description: 'An ordered binder page. An empty slots array preserves an empty page; omitted positions remain empty.',
  example: BINDER_PAGE_EXAMPLE,
});

export const LayoutSchema = z
  .object({
    columns: DimensionSchema,
    rows: DimensionSchema,
    pages: z.array(PageSchema),
  })
  .superRefine((layout, context) => {
    const pages = new Set<string>();
    layout.pages.forEach((page, index) => {
      if (pages.has(page.id)) {
        context.addIssue({ code: 'custom', path: ['pages', index, 'id'], message: 'Duplicate page' });
      }

      pages.add(page.id);
      const positions = new Set<string>();
      page.slots.forEach((slot, slotIndex) => {
        const position = `${slot.row}:${slot.column}`;

        if (slot.row > layout.rows || slot.column > layout.columns || positions.has(position)) {
          context.addIssue({
            code: 'custom',
            path: ['pages', index, 'slots', slotIndex],
            message: 'Invalid or duplicate slot position',
          });
        }

        positions.add(position);
      });
    });
  })
  .meta({
    $id: 'BinderLayout',
    title: 'Binder Layout',
    description: `Independent column and row counts from 1 to ${MAX_BINDER_DIMENSION}, with ordered pages; omitted positions remain empty`,
    example: BINDER_LAYOUT_EXAMPLE,
  });

export const RevisionSchema = z.int32().nonnegative().meta({
  description: 'Current collection revision; send this value when renaming or replacing a layout to detect stale edits',
  example: 0,
});

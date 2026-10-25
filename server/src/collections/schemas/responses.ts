import { z } from 'zod';

import {
  COLLECTION_SUMMARY_EXAMPLE,
  COLLECTION_EXAMPLE,
  COLLECTION_BACKUP_CARD_EXAMPLE,
  COLLECTION_BACKUP_EXAMPLE,
} from './examples.ts';
import { LayoutSchema, RevisionSchema } from './fields.ts';
import { ImportCardSchema } from '../../cards/schemas/payloads.ts';
import { CardWithPriceSchema } from '../../cards/schemas/responses.ts';
import { ApiCountSchema, UuidSchema } from '../../schemas/common.ts';
import { COLLECTION_BACKUP_VERSION, MAX_COLLECTION_NAME_LENGTH } from '../constants.ts';

export const CollectionSummarySchema = z
  .object({
    id: UuidSchema,
    name: z.string().min(1).max(MAX_COLLECTION_NAME_LENGTH),
    is_unfiled: z.boolean(),
    revision: RevisionSchema,
  })
  .meta({
    $id: 'CardCollectionSummary',
    title: 'Card Collection Summary',
    description: 'Collection identity, name, Unfiled status, and revision without loading its binder layout',
    example: COLLECTION_SUMMARY_EXAMPLE,
  });

export const CollectionSchema = z.intersection(CollectionSummarySchema, LayoutSchema).meta({
  $id: 'CardCollection',
  title: 'Card Collection',
  description: 'A collection summary together with its complete binder layout, including empty pages and positions',
  example: COLLECTION_EXAMPLE,
});

export const CollectionsSchema = z.object({ collections: z.array(CollectionSummarySchema) }).meta({
  $id: 'CardCollections',
  title: 'Card Collections',
  description: "Summaries of the authenticated account's collections, including its Unfiled collection",
  example: {
    collections: [
      { ...COLLECTION_SUMMARY_EXAMPLE, id: '550e8400-e29b-41d4-a716-446655440011', name: 'Unfiled', is_unfiled: true },
      COLLECTION_SUMMARY_EXAMPLE,
    ],
  },
});

export type CollectionSummary = z.infer<typeof CollectionSummarySchema>;

const BackupCardSchema = z.intersection(ImportCardSchema, z.object({ collection_id: UuidSchema })).meta({
  $id: 'CollectionBackupCard',
  title: 'Collection Backup Card',
  description: 'A complete card backup with the owning collection identifier used to restore membership',
  example: COLLECTION_BACKUP_CARD_EXAMPLE,
});

export const BackupSchema = z
  .object({
    version: z.literal(COLLECTION_BACKUP_VERSION),
    collections: z.array(CollectionSchema),
    cards: z.array(BackupCardSchema),
  })
  .superRefine((backup, context) => {
    const collections = new Map(backup.collections.map(collection => [collection.id, collection]));
    const cards = new Map(backup.cards.map(card => [card.id, card]));

    const quantities = new Map(
      backup.cards.map(card => [card.id, card.purchases.reduce((sum, p) => sum + p.quantity, 0)]),
    );

    if (
      collections.size !== backup.collections.length ||
      cards.size !== backup.cards.length ||
      backup.collections.filter(c => c.is_unfiled).length > 1
    ) {
      context.addIssue({ code: 'custom', message: 'Backup identities must be unique' });
    }

    backup.cards.forEach((card, index) => {
      if (!collections.has(card.collection_id)) {
        context.addIssue({
          code: 'custom',
          path: ['cards', index, 'collection_id'],
          message: 'Collection is absent from backup',
        });
      }
    });
    backup.collections.forEach((collection, index) => {
      const allocated = new Map<string, number>();

      for (const page of collection.pages) {
        for (const slot of page.slots) {
          allocated.set(slot.card_id, (allocated.get(slot.card_id) ?? 0) + slot.quantity);
          const card = cards.get(slot.card_id);

          if (
            card?.collection_id !== collection.id ||
            (allocated.get(slot.card_id) ?? 0) > (quantities.get(slot.card_id) ?? 0)
          ) {
            context.addIssue({
              code: 'custom',
              path: ['collections', index],
              message: 'Slot exceeds owned copies or references an absent card',
            });
          }
        }
      }
    });
  })
  .meta({
    $id: 'CollectionBackup',
    title: 'Collection Backup',
    description: 'A complete versioned backup of selected collections, their layouts, cards, and purchase history',
    example: COLLECTION_BACKUP_EXAMPLE,
  });

export const ImportBackupResponseSchema = z
  .object({
    imported_count: ApiCountSchema,
    updated_count: ApiCountSchema,
    skipped_count: ApiCountSchema,
    collection_count: ApiCountSchema,
  })
  .meta({
    $id: 'ImportCollectionBackupResult',
    title: 'Import Collection Backup Result',
    description: 'Counts of newly imported, updated, and unchanged cards, and collections processed by the import',
    example: { imported_count: 1, updated_count: 0, skipped_count: 0, collection_count: 1 },
  });

export const BackupPreviewSchema = z
  .object({
    new_collection_count: ApiCountSchema,
    updated_collection_count: ApiCountSchema,
    new_card_count: ApiCountSchema,
    updated_card_count: ApiCountSchema,
    moved_card_count: ApiCountSchema,
  })
  .meta({
    $id: 'CollectionBackupPreview',
    title: 'Collection Backup Preview',
    description: 'Projected collection, card, and membership changes without persisting the backup',
    example: {
      new_collection_count: 1,
      updated_collection_count: 0,
      new_card_count: 1,
      updated_card_count: 0,
      moved_card_count: 0,
    },
  });

export type Collection = z.infer<typeof CollectionSchema>;

export type CollectionBackup = z.infer<typeof BackupSchema>;

export const DeleteCollectionResponseSchema = z.object({ deleted: z.boolean() }).meta({
  $id: 'DeleteCollectionResult',
  title: 'Delete Collection Result',
  description: 'Confirms collection deletion; its cards remain owned and are moved to Unfiled',
  example: { deleted: true },
});

export const BinderPageCardsSchema = z.object({ cards: z.array(CardWithPriceSchema) }).meta({
  $id: 'BinderPageCards',
  title: 'Binder Page Cards',
  description:
    'Distinct owned cards placed on the requested page, with current pricing; empty pages return an empty array',
  example: { cards: [] },
});

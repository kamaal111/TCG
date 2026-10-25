import { z } from 'zod';

import { BINDER_LAYOUT_EXAMPLE, COLLECTION_BACKUP_EXAMPLE, COLLECTION_SUMMARY_EXAMPLE } from './examples.ts';
import { LayoutSchema, RevisionSchema } from './fields.ts';
import { BackupSchema } from './responses.ts';
import { UuidSchema } from '../../schemas/common.ts';
import { MAX_COLLECTION_NAME_LENGTH } from '../constants.ts';
import type { CollectionPolicy } from '../types.ts';

export const CreateCollectionSchema = z
  .object({ name: z.string().trim().min(1).max(MAX_COLLECTION_NAME_LENGTH) })
  .meta({
    $id: 'CreateCollection',
    title: 'Create Collection',
    description: 'A collection name, trimmed before storage',
    example: { name: COLLECTION_SUMMARY_EXAMPLE.name },
  });

export const UpdateCollectionSchema = z
  .intersection(CreateCollectionSchema, z.object({ revision: RevisionSchema }))
  .meta({
    $id: 'UpdateCollection',
    title: 'Update Collection',
    description: 'Rename a collection using its current revision; a stale revision returns a conflict',
    example: { name: COLLECTION_SUMMARY_EXAMPLE.name, revision: COLLECTION_SUMMARY_EXAMPLE.revision },
  });

export function createCollectionRequestSchemas(policy: CollectionPolicy) {
  return {
    backup: BackupSchema.safeExtend({
      collections: BackupSchema.shape.collections.max(policy.COLLECTION_MAX_COLLECTIONS),
      cards: BackupSchema.shape.cards.max(policy.COLLECTION_MAX_CARDS),
    }).meta({
      $id: 'ImportCollectionBackup',
      title: 'Import Collection Backup',
      description: 'A complete backup to preview or merge, subject to the configured request and collection budgets',
      example: COLLECTION_BACKUP_EXAMPLE,
    }),
    layout: z
      .intersection(
        LayoutSchema,
        z.object({
          revision: RevisionSchema,
          pages: LayoutSchema.shape.pages.max(policy.COLLECTION_MAX_PAGES).optional(),
        }),
      )
      .meta({
        $id: 'SaveBinderLayout',
        title: 'Save Binder Layout',
        description:
          'Atomically replace dimensions and ordered pages using the current collection revision; omitted slots are cleared',
        example: { ...BINDER_LAYOUT_EXAMPLE, revision: COLLECTION_SUMMARY_EXAMPLE.revision },
      }),
    export: z
      .object({
        collection_ids: z.array(UuidSchema).min(1).max(policy.COLLECTION_MAX_COLLECTIONS).optional(),
      })
      .meta({
        $id: 'ExportCollections',
        title: 'Export Collections',
        description:
          'Select owned collection identifiers for a complete backup; omit collection_ids to export all collections',
        example: { collection_ids: [COLLECTION_SUMMARY_EXAMPLE.id] },
      }),
  };
}

export type SaveLayout = z.infer<ReturnType<typeof createCollectionRequestSchemas>['layout']>;

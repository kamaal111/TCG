import { ImportCardSchema, ImportCardsSchema } from '../../cards/schemas/payloads.ts';
import { DEFAULT_COLLECTION_POLICY } from '../../config.ts';
import { LayoutSchema } from '../schemas/fields.ts';
import { CreateCollectionSchema, UpdateCollectionSchema, createCollectionRequestSchemas } from '../schemas/payloads.ts';
import {
  BackupPreviewSchema,
  BackupSchema,
  BinderPageCardsSchema,
  CollectionSchema,
  CollectionSummarySchema,
  CollectionsSchema,
  DeleteCollectionResponseSchema,
  ImportBackupResponseSchema,
} from '../schemas/responses.ts';

const SCHEMAS = [
  ImportCardSchema,
  ImportCardsSchema,
  LayoutSchema,
  CreateCollectionSchema,
  UpdateCollectionSchema,
  CollectionSchema,
  CollectionSummarySchema,
  CollectionsSchema,
  BackupSchema,
  ImportBackupResponseSchema,
  BackupPreviewSchema,
  DeleteCollectionResponseSchema,
  BinderPageCardsSchema,
  ...Object.values(createCollectionRequestSchemas(DEFAULT_COLLECTION_POLICY)),
];

test.each(SCHEMAS.map(schema => ({ name: schema.meta()?.$id, schema })))(
  'documents $name with a description and a valid example',
  ({ schema }) => {
    const metadata = schema.meta();

    expect(metadata?.description).toEqual(expect.stringMatching(/\S/));
    expect(schema.safeParse(metadata?.example).success).toBe(true);
  },
);

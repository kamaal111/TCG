import { z } from 'zod';

import { IMPORT_CARD_EXAMPLE } from './examples.ts';
import { CardWithPriceSchema } from './responses.ts';
import { OWNED_CARD_PRICE_STATUSES } from '../../card-pricing/schemas/responses.ts';
import { COLLECTION_EXAMPLE } from '../../collections/schemas/examples.ts';
import { CollectionSchema } from '../../collections/schemas/responses.ts';
import { UuidSchema } from '../../schemas/common.ts';

const MAX_BATCH_SIZE = 100;

const cardEntry = {
  kind: 'card',
  id: IMPORT_CARD_EXAMPLE.id,
  hash: '4f69558ba5ec3c0474fba5e798c701d179ed78501cacbc936c66af8ca8b43a18',
};

const collectionEntry = {
  kind: 'collection',
  id: COLLECTION_EXAMPLE.id,
  hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
};

const EntrySchema = z
  .object({
    kind: z.enum(['card', 'collection']).meta({
      description: 'Whether this entry identifies an owned card or a collection layout.',
      example: cardEntry.kind,
    }),
    id: UuidSchema.meta({
      description: 'Identifier of the record within its kind.',
      example: cardEntry.id,
    }),
    hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .meta({
        description: 'SHA-256 hex digest of the record returned by the offline records endpoint.',
        example: cardEntry.hash,
      }),
  })
  .meta({
    $id: 'OfflineCollectionEntry',
    title: 'Offline Collection Entry',
    description: 'The identity and current digest of one downloadable record.',
    example: cardEntry,
  });

export const OfflineManifestETagHeadersSchema = z.object({
  ETag: z.string().meta({
    description: 'Weak validator for the manifest. Send this value as If-None-Match on a later request.',
    example: `W/"${cardEntry.hash}"`,
  }),
});

export const OfflineManifestRequestHeadersSchema = z.object({
  'if-none-match': z
    .string()
    .optional()
    .meta({
      description: 'A previous manifest ETag. A match returns 304 with no response body.',
      example: `W/"${cardEntry.hash}"`,
    }),
});

export const ManifestSchema = z
  .object({
    version: z.literal(1).meta({ description: 'Offline manifest format version.', example: 1 }),
    account_id: z.string().meta({
      description: 'Identifier of the authenticated account that owns this snapshot.',
      example: 'acct_demo_1',
    }),
    entries: z.array(EntrySchema).meta({
      description: 'The full record inventory. Remove local records absent from this list.',
    }),
    needs_preparation: z.array(UuidSchema).meta({
      description: 'Owned card IDs with missing cached provider details that can be sent for preparation.',
      example: [cardEntry.id],
    }),
  })
  .meta({
    $id: 'OfflineCollectionManifest',
    title: 'Offline Collection Manifest',
    description: 'The authenticated account’s record inventory and pending provider lookups.',
    example: {
      version: 1,
      account_id: 'acct_demo_1',
      entries: [cardEntry, collectionEntry],
      needs_preparation: [cardEntry.id],
    },
  });

export const OfflineRecordsRequestSchema = z
  .object({
    entries: z.array(EntrySchema).nonempty().max(MAX_BATCH_SIZE).meta({
      description: 'Between 1 and 100 entries copied from the current manifest.',
    }),
  })
  .meta({
    title: 'Offline Records Request',
    description: 'The subset of manifest entries that the client wants to download.',
    example: { entries: [cardEntry, collectionEntry] },
  });

export const RecordsSchema = z
  .object({
    cards: z.array(CardWithPriceSchema).meta({ description: 'Requested owned cards with cached provider details.' }),
    collections: z.array(CollectionSchema).meta({ description: 'Requested collections with their binder layouts.' }),
  })
  .meta({
    $id: 'OfflineCollectionRecords',
    title: 'Offline Collection Records',
    description: 'A batch of owned cards and collection layouts verified against the manifest.',
    example: {
      cards: [
        {
          ...IMPORT_CARD_EXAMPLE,
          collection_id: COLLECTION_EXAMPLE.id,
          purchase_price_change_percent: null,
          price: { card_id: cardEntry.id, status: OWNED_CARD_PRICE_STATUSES.UNAVAILABLE },
        },
      ],
      collections: [COLLECTION_EXAMPLE],
    },
  });

export const PrepareOfflineCardsRequestSchema = z
  .object({
    card_ids: z.array(UuidSchema).nonempty().max(MAX_BATCH_SIZE).meta({
      description: 'Between 1 and 100 owned card IDs from the manifest’s needs_preparation list.',
    }),
  })
  .meta({
    title: 'Prepare Offline Cards Request',
    description: 'Requests provider lookups for owned cards missing cached details.',
    example: { card_ids: [cardEntry.id] },
  });

export const PrepareOfflineCardsResponseSchema = z
  .object({
    retry_card_ids: z.array(UuidSchema).meta({
      description: 'Cards whose provider lookups failed temporarily. An empty list means no retries are needed.',
    }),
  })
  .meta({
    title: 'Prepare Offline Cards Response',
    description: 'Reports which provider lookups the client can retry before refreshing the manifest.',
    example: { retry_card_ids: [cardEntry.id] },
  });

import { defineRelationsPart, sql } from 'drizzle-orm';
import { check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

type CardImageStatusMap = {
  [Status in (typeof CARD_IMAGE_STATUS_ARRAY)[number] as Uppercase<Status>]: Status;
};

const CARD_IMAGE_STATUS_ARRAY = ['pending', 'fetching', 'ready', 'failed'] as const;

export const CARD_IMAGE_STATUSES = {
  PENDING: 'pending',
  FETCHING: 'fetching',
  READY: 'ready',
  FAILED: 'failed',
} satisfies CardImageStatusMap;

export const cardImageStatusEnum = pgEnum('card_image_status', CARD_IMAGE_STATUS_ARRAY);

export const cardImage = pgTable(
  'card_image',
  {
    imageKey: text('image_key').primaryKey(),
    originUrl: text('origin_url').notNull(),
    storageKey: text('storage_key').notNull(),
    status: cardImageStatusEnum('status').notNull().default('pending'),
    contentType: text('content_type'),
    contentLength: integer('content_length'),
    checksum: text('checksum'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    lastErrorCode: text('last_error_code'),
    lastAttemptedAt: timestamp('last_attempted_at'),
    nextAttemptAt: timestamp('next_attempt_at'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at'),
    storedAt: timestamp('stored_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  table => [
    uniqueIndex('card_image_image_key_idx').on(table.imageKey),
    index('card_image_work_queue_idx').on(table.status, table.nextAttemptAt, table.leaseExpiresAt),
    index('card_image_fetching_lease_idx')
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} = 'fetching'`),
    check(
      'card_image_ready_metadata_check',
      sql`${table.status} <> 'ready' OR (${table.contentType} IS NOT NULL AND ${table.contentLength} IS NOT NULL AND ${table.checksum} IS NOT NULL)`,
    ),
  ],
);

export const cardImageRelations = defineRelationsPart({ cardImage });

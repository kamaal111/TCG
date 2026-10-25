import z from 'zod';

import { PRICING_CLIENT_MODES, SERVER_MODES } from './constants/common.ts';
import { BYTES_PER_MB } from './constants/size.ts';
import { ONE_HOUR_IN_MS, ONE_MINUTE_IN_MS, ONE_SECOND_IN_MS } from './constants/time.ts';
import { CurrencySchema } from './forex/currencies.ts';

const LOG_LEVELS = {
  FATAL: 'fatal',
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'trace',
  SILENT: 'silent',
} as const;

export const DEFAULT_IMAGE_POLICY = {
  CARD_IMAGE_MAX_BYTES: 5 * BYTES_PER_MB,
  CARD_IMAGE_REQUEST_TIMEOUT_MS: 8 * ONE_SECOND_IN_MS,
  CARD_IMAGE_WARM_CONCURRENCY: 2,
  CARD_IMAGE_LEASE_DURATION_MS: 30 * ONE_SECOND_IN_MS,
  CARD_IMAGE_WORKER_POLL_INTERVAL_MS: 5 * ONE_SECOND_IN_MS,
  CARD_IMAGE_FOREGROUND_WAIT_MS: 10 * ONE_SECOND_IN_MS,
  CARD_IMAGE_MAX_ATTEMPTS: 5,
  CARD_IMAGE_RETRY_AFTER_MS: 5 * ONE_MINUTE_IN_MS,
  CARD_IMAGE_MAX_RETRY_AFTER_MS: 6 * ONE_HOUR_IN_MS,
  CARD_IMAGE_ORIGIN_URL_PATTERN_LIMIT: 1000,
} as const;

export const DEFAULT_IMPORT_POLICY = { CARD_IMPORT_BATCH_SIZE: 100, CARD_IMPORT_PURCHASE_BATCH_SIZE: 1000 } as const;

export const DEFAULT_COLLECTION_POLICY = {
  COLLECTION_MAX_BODY_BYTES: 8 * BYTES_PER_MB,
  COLLECTION_MAX_COLLECTIONS: 500,
  COLLECTION_MAX_CARDS: 5000,
  COLLECTION_MAX_PAGES: 2000,
  COLLECTION_MAX_SLOTS: 25000,
  COLLECTION_MAX_PURCHASES: 25000,
  COLLECTION_BODY_TIMEOUT_MS: 30 * ONE_SECOND_IN_MS,
  COLLECTION_OPERATION_TIMEOUT_MS: 2 * ONE_MINUTE_IN_MS,
  COLLECTION_STATEMENT_TIMEOUT_MS: 10 * ONE_SECOND_IN_MS,
  COLLECTION_LOCK_TIMEOUT_MS: 2 * ONE_SECOND_IN_MS,
  COLLECTION_CONCURRENCY: 4,
} as const;

const DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS = 2 * ONE_SECOND_IN_MS;

const BaseEnvSchema = z.object({
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS),
  COLLECTION_MAX_BODY_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_COLLECTION_POLICY.COLLECTION_MAX_BODY_BYTES),
  COLLECTION_MAX_COLLECTIONS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_COLLECTION_POLICY.COLLECTION_MAX_COLLECTIONS),
  COLLECTION_MAX_CARDS: z.coerce.number().int().positive().default(DEFAULT_COLLECTION_POLICY.COLLECTION_MAX_CARDS),
  COLLECTION_MAX_PAGES: z.coerce.number().int().positive().default(DEFAULT_COLLECTION_POLICY.COLLECTION_MAX_PAGES),
  COLLECTION_MAX_SLOTS: z.coerce.number().int().positive().default(DEFAULT_COLLECTION_POLICY.COLLECTION_MAX_SLOTS),
  COLLECTION_MAX_PURCHASES: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_COLLECTION_POLICY.COLLECTION_MAX_PURCHASES),
  COLLECTION_BODY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_COLLECTION_POLICY.COLLECTION_BODY_TIMEOUT_MS),
  COLLECTION_OPERATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_COLLECTION_POLICY.COLLECTION_OPERATION_TIMEOUT_MS),
  COLLECTION_STATEMENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_COLLECTION_POLICY.COLLECTION_STATEMENT_TIMEOUT_MS),
  COLLECTION_LOCK_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_COLLECTION_POLICY.COLLECTION_LOCK_TIMEOUT_MS),
  COLLECTION_CONCURRENCY: z.coerce.number().int().positive().default(DEFAULT_COLLECTION_POLICY.COLLECTION_CONCURRENCY),

  PORT: z.coerce.number().gte(1000).lt(10_000).default(8080),
  DATABASE_URL: z.string(),
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  MODE: z.enum(Object.values(SERVER_MODES)).default(SERVER_MODES.SERVER),
  DEBUG: z.coerce.boolean().default(false),
  LOG_LEVEL: z.enum(Object.values(LOG_LEVELS)).default(LOG_LEVELS.INFO),
  DEFAULT_PREFERRED_CURRENCY: CurrencySchema.default('USD'),
  BETTER_AUTH_SESSION_UPDATE_AGE_DAYS: z.coerce.number().gte(1).optional().default(1),
  BETTER_AUTH_SESSION_EXPIRY_DAYS: z.coerce.number().gte(1).optional().default(30),
  BETTER_AUTH_URL: z.url(),
  PUBLIC_BASE_URL: z.url().optional(),
  JWT_EXPIRY_DAYS: z.coerce.number().gte(1).optional().default(7),
  CARD_IMPORT_BATCH_SIZE: z.coerce.number().int().positive().default(DEFAULT_IMPORT_POLICY.CARD_IMPORT_BATCH_SIZE),
  CARD_IMPORT_PURCHASE_BATCH_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_IMPORT_POLICY.CARD_IMPORT_PURCHASE_BATCH_SIZE),
  SCRYDEX_CLIENT: z.enum(Object.values(PRICING_CLIENT_MODES)).default(PRICING_CLIENT_MODES.STATIC),
  SCRYDEX_API_KEY: z.string().min(1).optional(),
  SCRYDEX_TEAM_ID: z.string().min(1).optional(),
  SCRYDEX_BASE_URL: z.url().default('https://api.scrydex.com'),
  SCRYDEX_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * ONE_SECOND_IN_MS),
  PRICING_LOCK_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(12 * ONE_SECOND_IN_MS),
  OBJECT_STORAGE_ENDPOINT: z.url().optional(),
  OBJECT_STORAGE_REGION: z.string().min(1).default('us-east-1'),
  OBJECT_STORAGE_BUCKET: z.string().min(1).default('tcg-card-images'),
  OBJECT_STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  OBJECT_STORAGE_FORCE_PATH_STYLE: z.stringbool().default(true),
  OBJECT_STORAGE_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * ONE_SECOND_IN_MS),
  OBJECT_STORAGE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(2),
  CARD_IMAGE_MAX_BYTES: z.coerce.number().int().positive().default(DEFAULT_IMAGE_POLICY.CARD_IMAGE_MAX_BYTES),
  CARD_IMAGE_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_IMAGE_POLICY.CARD_IMAGE_REQUEST_TIMEOUT_MS),
  CARD_IMAGE_WARM_CONCURRENCY: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_IMAGE_POLICY.CARD_IMAGE_WARM_CONCURRENCY),
  CARD_IMAGE_LEASE_DURATION_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_IMAGE_POLICY.CARD_IMAGE_LEASE_DURATION_MS),
  CARD_IMAGE_WORKER_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_IMAGE_POLICY.CARD_IMAGE_WORKER_POLL_INTERVAL_MS),
  CARD_IMAGE_FOREGROUND_WAIT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_IMAGE_POLICY.CARD_IMAGE_FOREGROUND_WAIT_MS),
  CARD_IMAGE_WORKER_ENABLED: z.stringbool().default(true),
  CARD_IMAGE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(DEFAULT_IMAGE_POLICY.CARD_IMAGE_MAX_ATTEMPTS),
  CARD_IMAGE_RETRY_AFTER_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_IMAGE_POLICY.CARD_IMAGE_RETRY_AFTER_MS),
  CARD_IMAGE_MAX_RETRY_AFTER_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_IMAGE_POLICY.CARD_IMAGE_MAX_RETRY_AFTER_MS),
  CARD_IMAGE_ORIGIN_URL_PATTERN_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_IMAGE_POLICY.CARD_IMAGE_ORIGIN_URL_PATTERN_LIMIT),
  CARD_IMAGE_WARM_ON_REGISTER: z.stringbool().default(true),
});

export const EnvSchema = BaseEnvSchema.superRefine((value, context) => {
  if (value.SCRYDEX_CLIENT === PRICING_CLIENT_MODES.REAL && value.SCRYDEX_API_KEY == null) {
    context.addIssue({
      code: 'custom',
      path: ['SCRYDEX_API_KEY'],
      message: 'SCRYDEX_API_KEY is required when SCRYDEX_CLIENT is real',
    });
  }

  if (value.SCRYDEX_CLIENT === PRICING_CLIENT_MODES.REAL && value.SCRYDEX_TEAM_ID == null) {
    context.addIssue({
      code: 'custom',
      path: ['SCRYDEX_TEAM_ID'],
      message: 'SCRYDEX_TEAM_ID is required when SCRYDEX_CLIENT is real',
    });
  }
});

export type Env = z.infer<typeof EnvSchema>;

export const ApplicationConfigSchema = BaseEnvSchema.omit({
  DATABASE_URL: true,
  BETTER_AUTH_SECRET: true,
  OBJECT_STORAGE_ENDPOINT: true,
  OBJECT_STORAGE_REGION: true,
  OBJECT_STORAGE_BUCKET: true,
  OBJECT_STORAGE_ACCESS_KEY_ID: true,
  OBJECT_STORAGE_SECRET_ACCESS_KEY: true,
  OBJECT_STORAGE_FORCE_PATH_STYLE: true,
  OBJECT_STORAGE_REQUEST_TIMEOUT_MS: true,
  OBJECT_STORAGE_MAX_ATTEMPTS: true,
})
  .extend({
    CARD_IMAGE_WORKER_ENABLED: z.union([z.boolean(), z.stringbool()]).default(true),
    CARD_IMAGE_WARM_ON_REGISTER: z.union([z.boolean(), z.stringbool()]).default(true),
  })
  .transform(value => ({
    ...value,
    BASE_URL: value.BETTER_AUTH_URL,
    PUBLIC_BASE_URL: value.PUBLIC_BASE_URL ?? value.BETTER_AUTH_URL,
    IS_TEST: value.MODE === SERVER_MODES.TEST,
  }));

export type ApplicationConfig = z.infer<typeof ApplicationConfigSchema>;

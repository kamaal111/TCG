import z from 'zod';

import { OBJECT_STORAGE_PROVIDERS, PRICING_CLIENT_MODES, SERVER_MODES } from './constants/common.ts';

const LOG_LEVELS = {
  FATAL: 'fatal',
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'trace',
  SILENT: 'silent',
} as const;

export const EnvSchema = z
  .object({
    PORT: z.coerce.number().gte(1000).lt(10_000).default(8080),
    DATABASE_URL: z.string(),
    MODE: z.enum(Object.values(SERVER_MODES)).default(SERVER_MODES.SERVER),
    DEBUG: z.coerce.boolean().default(false),
    LOG_LEVEL: z.enum(Object.values(LOG_LEVELS)).default(LOG_LEVELS.INFO),
    BETTER_AUTH_SESSION_UPDATE_AGE_DAYS: z.coerce.number().gte(1).optional().default(1),
    BETTER_AUTH_SESSION_EXPIRY_DAYS: z.coerce.number().gte(1).optional().default(30),
    BETTER_AUTH_URL: z.url(),
    PUBLIC_BASE_URL: z.url().optional(),
    JWT_EXPIRY_DAYS: z.coerce.number().gte(1).optional().default(7),
    SCRYDEX_CLIENT: z.enum(Object.values(PRICING_CLIENT_MODES)).default(PRICING_CLIENT_MODES.STATIC),
    SCRYDEX_API_KEY: z.string().min(1).optional(),
    SCRYDEX_TEAM_ID: z.string().min(1).optional(),
    SCRYDEX_BASE_URL: z.url().default('https://api.scrydex.com'),
    SCRYDEX_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    PRICING_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
    OBJECT_STORAGE_CLIENT: z.enum(Object.values(OBJECT_STORAGE_PROVIDERS)).default(OBJECT_STORAGE_PROVIDERS.MEMORY),
    OBJECT_STORAGE_ENDPOINT: z.url().optional(),
    OBJECT_STORAGE_REGION: z.string().min(1).default('us-east-1'),
    OBJECT_STORAGE_BUCKET: z.string().min(1).default('tcg-card-images'),
    OBJECT_STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    OBJECT_STORAGE_FORCE_PATH_STYLE: z.stringbool().default(true),
    OBJECT_STORAGE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    OBJECT_STORAGE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(2),
    CARD_IMAGE_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 1024 * 1024),
    CARD_IMAGE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    CARD_IMAGE_WARM_CONCURRENCY: z.coerce.number().int().positive().default(2),
    CARD_IMAGE_LEASE_DURATION_MS: z.coerce.number().int().positive().default(30_000),
    CARD_IMAGE_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
    CARD_IMAGE_FOREGROUND_WAIT_MS: z.coerce.number().int().positive().default(10_000),
    CARD_IMAGE_WORKER_ENABLED: z.stringbool().default(true),
    CARD_IMAGE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    CARD_IMAGE_RETRY_AFTER_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(5 * 60 * 1000),
    CARD_IMAGE_WARM_ON_REGISTER: z.stringbool().default(true),
  })
  .superRefine((value, context) => {
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
    if (value.OBJECT_STORAGE_CLIENT === OBJECT_STORAGE_PROVIDERS.S3 && value.OBJECT_STORAGE_ACCESS_KEY_ID == null) {
      context.addIssue({
        code: 'custom',
        path: ['OBJECT_STORAGE_ACCESS_KEY_ID'],
        message: 'OBJECT_STORAGE_ACCESS_KEY_ID is required when OBJECT_STORAGE_CLIENT is s3',
      });
    }
    if (value.OBJECT_STORAGE_CLIENT === OBJECT_STORAGE_PROVIDERS.S3 && value.OBJECT_STORAGE_SECRET_ACCESS_KEY == null) {
      context.addIssue({
        code: 'custom',
        path: ['OBJECT_STORAGE_SECRET_ACCESS_KEY'],
        message: 'OBJECT_STORAGE_SECRET_ACCESS_KEY is required when OBJECT_STORAGE_CLIENT is s3',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

const env = EnvSchema.parse(process.env);

const IS_TEST = env.MODE === SERVER_MODES.TEST;

export default {
  ...env,
  BASE_URL: env.BETTER_AUTH_URL,
  PUBLIC_BASE_URL: env.PUBLIC_BASE_URL ?? env.BETTER_AUTH_URL,
  IS_TEST,
};

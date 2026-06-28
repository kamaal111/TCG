import z from 'zod';

import { SERVER_MODES } from './modes.ts';

const LOG_LEVELS = {
  FATAL: 'fatal',
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'trace',
  SILENT: 'silent',
} as const;

const EnvSchema = z.object({
  PORT: z.coerce.number().gte(1000).lt(10_000).default(8080),
  DATABASE_URL: z.string(),
  MODE: z.enum(Object.values(SERVER_MODES)).default(SERVER_MODES.SERVER),
  DEBUG: z.coerce.boolean().default(false),
  LOG_LEVEL: z.enum(Object.values(LOG_LEVELS)).default(LOG_LEVELS.INFO),
  BETTER_AUTH_SESSION_UPDATE_AGE_DAYS: z.coerce.number().gte(1).optional().default(1),
  BETTER_AUTH_SESSION_EXPIRY_DAYS: z.coerce.number().gte(1).optional().default(30),
  BETTER_AUTH_URL: z.url(),
  JWT_EXPIRY_DAYS: z.coerce.number().gte(1).optional().default(7),
});

const env = EnvSchema.parse(process.env);

export default env;

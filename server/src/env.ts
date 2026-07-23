import z from 'zod';

import { SERVER_MODES } from './constants/common.ts';

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
    JWT_EXPIRY_DAYS: z.coerce.number().gte(1).optional().default(7),
    TCGGO_CLIENT: z.enum(['static', 'real']).default('static'),
    TCGGO_API_KEY: z.string().min(1).optional(),
    TCGGO_API_HOST: z.string().default('cardmarket-api-tcg.p.rapidapi.com'),
    TCGGO_BASE_URL: z.url().default('https://cardmarket-api-tcg.p.rapidapi.com'),
    TCGGO_ONE_PIECE_PATH: z.string().min(1).default('onepiece'),
    TCGGO_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    PRICING_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
  })
  .superRefine((value, context) => {
    if (value.TCGGO_CLIENT === 'real' && value.TCGGO_API_KEY == null) {
      context.addIssue({
        code: 'custom',
        path: ['TCGGO_API_KEY'],
        message: 'TCGGO_API_KEY is required when TCGGO_CLIENT is real',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

const env = EnvSchema.parse(process.env);

const IS_TEST = env.MODE === SERVER_MODES.TEST;

export default { ...env, BASE_URL: env.BETTER_AUTH_URL, IS_TEST };

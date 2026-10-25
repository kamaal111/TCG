import { ApplicationConfigSchema } from '../../config.ts';
import { createDatabase } from '../../db/index.ts';
import env from '../../env.ts';
import { createBetterAuth } from '../../persistence/postgres/auth-client.ts';

/** Only the explicit schema-generation recipe loads this tooling entry point. */
export const auth = createBetterAuth(
  createDatabase({ url: env.DATABASE_URL, connectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT_MS }),
  ApplicationConfigSchema.parse(env),
  env.BETTER_AUTH_SECRET,
);

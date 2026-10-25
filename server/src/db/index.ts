import { drizzle } from 'drizzle-orm/node-postgres';

import { appRelations } from './schema/index.ts';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(options: { url: string; connectionTimeoutMs: number; debug?: boolean }) {
  return drizzle<typeof appRelations>({
    connection: { connectionString: options.url, connectionTimeoutMillis: options.connectionTimeoutMs },
    relations: appRelations,
    logger: options.debug ?? false,
  });
}

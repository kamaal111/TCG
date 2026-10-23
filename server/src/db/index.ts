import { drizzle } from 'drizzle-orm/node-postgres';

import { appRelations } from './schema/index.ts';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(options: { url: string; debug?: boolean }) {
  return drizzle<typeof appRelations>(options.url, { relations: appRelations, logger: options.debug ?? false });
}

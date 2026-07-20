import { drizzle } from 'drizzle-orm/node-postgres';

import env from '../env.ts';
import { appRelations } from './schema/index.ts';

export type Database = typeof db;

const db = drizzle<typeof appRelations>(env.DATABASE_URL, { relations: appRelations, logger: env.DEBUG });

export default db;

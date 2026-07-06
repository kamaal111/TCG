import { drizzle } from 'drizzle-orm/node-postgres';

import env from '../env.ts';
import { authRelations } from './schema/index.ts';

export type Database = typeof db;

const db = drizzle<typeof authRelations>(env.DATABASE_URL, { relations: authRelations, logger: env.DEBUG });

export default db;

import { drizzle } from 'drizzle-orm/node-postgres';

import env from '../env.ts';

export type Database = typeof db;

const db = drizzle(env.DATABASE_URL, { logger: env.DEBUG });

export default db;

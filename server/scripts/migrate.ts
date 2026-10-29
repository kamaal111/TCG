import path from 'node:path';

import { migrateDatabase } from '../src/db/migrate.ts';

try {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString == null || connectionString === '') {
    console.error('DATABASE_URL is required. Run just migrate from the repository root.');
    process.exitCode = 1;
  } else {
    await migrateDatabase({ folder: path.resolve('drizzle'), connectionString });
    console.log('Database migrations completed.');
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

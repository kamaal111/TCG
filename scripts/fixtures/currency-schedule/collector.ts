import fs from 'node:fs';
import path from 'node:path';

fs.writeFileSync(
  path.resolve('../collected.json'),
  JSON.stringify({
    database: process.env.DATABASE_URL,
    debug: process.env.DEBUG,
    mode: process.env.NODE_ENV,
    cwd: process.cwd(),
  }),
);

process.exitCode = Number(process.env.COLLECTOR_TEST_EXIT || 0);

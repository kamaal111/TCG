import assert from 'node:assert/strict';
import fs from 'node:fs';
import util from 'node:util';

import { ForexCollectorEnvSchema } from '../server/src/config.ts';

try {
  const [file, action, ...extra] = process.argv.slice(2);
  assert(file && extra.length === 0, 'Provide an environment file and install, preview, or run action.');
  assert(action === 'install' || action === 'preview' || action === 'run', 'Invalid currency schedule action.');
  assert((fs.statSync(file).mode & 0o077) === 0, 'Restrict the environment file permissions with chmod 600.');
  const config = ForexCollectorEnvSchema.safeParse(util.parseEnv(fs.readFileSync(file, 'utf8')));
  assert(config.success, 'Invalid collector configuration: provide DATABASE_URL and valid collector settings.');
  assert(!config.data.DEBUG, 'Omit DEBUG from the currency environment file; nonempty strings enable it.');
  assert(URL.canParse(config.data.DATABASE_URL), 'DATABASE_URL must be a PostgreSQL connection URL.');
  assert(
    ['postgresql:', 'postgres:'].includes(new URL(config.data.DATABASE_URL).protocol),
    'DATABASE_URL must be a PostgreSQL connection URL.',
  );

  if (action !== 'run') {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    assert(
      ['Europe/Amsterdam', 'Europe/Berlin'].includes(timezone),
      'Set the Mac timezone to Europe/Amsterdam or Europe/Berlin before installing the 17:15 schedule.',
    );
  }

  console.log(process.execPath);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Currency schedule validation failed.');
  process.exitCode = 1;
}

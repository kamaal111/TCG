import childProcess from 'node:child_process';

import { ApplicationConfigSchema, EnvSchema, ForexCollectorEnvSchema } from '../server/src/config.ts';

const databaseURL = 'postgresql://tcg:secret@localhost/tcg';

it('accepts database-only collector configuration with existing defaults', () => {
  expect(ForexCollectorEnvSchema.parse({ DATABASE_URL: databaseURL })).toEqual({
    DATABASE_URL: databaseURL,
    DATABASE_CONNECTION_TIMEOUT_MS: 2000,
    DEBUG: false,
    LOG_LEVEL: 'info',
    MODE: 'SERVER',
  });
});

it('ignores unused auth, HTTP, pricing, and storage configuration', () => {
  expect(
    ForexCollectorEnvSchema.parse({
      DATABASE_URL: databaseURL,
      BETTER_AUTH_URL: 'invalid',
      PORT: 'invalid',
      SCRYDEX_CLIENT: 'real',
      OBJECT_STORAGE_ENDPOINT: 'invalid',
    }),
  ).toEqual(ForexCollectorEnvSchema.parse({ DATABASE_URL: databaseURL }));
});

it('accepts collector timeout and logging settings', () => {
  expect(
    ForexCollectorEnvSchema.parse({
      DATABASE_URL: databaseURL,
      DATABASE_CONNECTION_TIMEOUT_MS: '1500',
      LOG_LEVEL: 'warn',
      MODE: 'TEST',
      DEBUG: 'true',
    }),
  ).toEqual({
    DATABASE_URL: databaseURL,
    DATABASE_CONNECTION_TIMEOUT_MS: 1500,
    LOG_LEVEL: 'warn',
    MODE: 'TEST',
    DEBUG: true,
  });
});

it.each([
  {},
  { DATABASE_URL: databaseURL, DATABASE_CONNECTION_TIMEOUT_MS: '0' },
  { DATABASE_URL: databaseURL, LOG_LEVEL: 'invalid' },
  { DATABASE_URL: databaseURL, MODE: 'invalid' },
])('rejects invalid collector configuration %j', config => {
  expect(ForexCollectorEnvSchema.safeParse(config).success).toBe(false);
});

it.each([undefined, 'invalid'])('still requires a valid auth URL for the server: %s', authURL => {
  const config = { DATABASE_URL: databaseURL, BETTER_AUTH_URL: authURL };
  expect(EnvSchema.safeParse(config).success).toBe(false);
  expect(ApplicationConfigSchema.safeParse(config).success).toBe(false);
});

it('still accepts valid server auth configuration', () => {
  const config = { DATABASE_URL: databaseURL, BETTER_AUTH_URL: 'https://tcg.example.com' };
  expect(EnvSchema.safeParse(config).success).toBe(true);
  expect(ApplicationConfigSchema.safeParse(config).success).toBe(true);
});

it('initializes real structured logging without database or auth configuration', () => {
  const result = childProcess.spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import { initializeNodeLogging } from './server/src/runtime/node/logging.ts';
        import { forexProcessLogger } from './server/src/forex/logging.ts';
        initializeNodeLogging();
        forexProcessLogger().info(
          { event: 'forex.collect.completed', outcome: 'success' },
          'Collector logging is ready.',
        );
      `,
    ],
    { env: {}, encoding: 'utf8', timeout: 10_000 },
  );

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    level: 30,
    service: 'tcg-server',
    mode: 'SERVER',
    event: 'forex.collect.completed',
    outcome: 'success',
    msg: 'Collector logging is ready.',
  });
});

it('starts the real collector without auth configuration and reports database failures', () => {
  const result = childProcess.spawnSync(process.execPath, ['server/scripts/fetch-daily-currencies.ts'], {
    env: { DATABASE_URL: 'postgresql://tcg:secret@127.0.0.1:1/tcg', DATABASE_CONNECTION_TIMEOUT_MS: '100' },
    encoding: 'utf8',
    timeout: 10_000,
  });

  expect(result.stderr).toBe('');
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    level: 50,
    event: 'forex.collect.failed',
    outcome: 'failure',
    error_code: 'FOREX_COLLECTION_FAILED',
  });
});

import childProcess from 'node:child_process';

import {
  ApplicationConfigSchema,
  createApplicationConfig,
  DEFAULT_APPLICATION_CONFIG,
  EnvSchema,
} from '../server/src/config.ts';

test('builds trusted configuration with the same defaults as validated environment input', () => {
  const baseURL = 'https://tcg.example.com';
  const config = createApplicationConfig({ ...DEFAULT_APPLICATION_CONFIG, BETTER_AUTH_URL: baseURL });

  expect(config).toStrictEqual(ApplicationConfigSchema.parse({ BETTER_AUTH_URL: baseURL }));
  expect(config.BASE_URL).toBe(baseURL);
  expect(config.PUBLIC_BASE_URL).toBe(baseURL);
  expect(config.IS_TEST).toBe(false);
});

test('preserves explicit typed settings and derives test mode and public URL', () => {
  const config = createApplicationConfig({
    ...DEFAULT_APPLICATION_CONFIG,
    BETTER_AUTH_URL: 'https://internal.example.com',
    PUBLIC_BASE_URL: 'https://public.example.com',
    MODE: 'TEST',
    CARD_IMAGE_WORKER_ENABLED: false,
  });

  expect(config.BASE_URL).toBe('https://internal.example.com');
  expect(config.PUBLIC_BASE_URL).toBe('https://public.example.com');
  expect(config.IS_TEST).toBe(true);
  expect(config.CARD_IMAGE_WORKER_ENABLED).toBe(false);
});

test('still requires database configuration for the production environment', () => {
  expect(EnvSchema.safeParse({ BETTER_AUTH_URL: 'https://tcg.example.com' }).success).toBe(false);
});

test.each(['static', undefined])('production rejects static or omitted pricing mode: %s', mode => {
  const parsed = EnvSchema.safeParse({
    NODE_ENV: 'production',
    MODE: 'TEST',
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
    BETTER_AUTH_URL: 'https://tcg.example.com',
    SCRYDEX_CLIENT: mode,
  });

  expect(parsed.success).toBe(false);
  expect(parsed.error?.issues).toContainEqual(expect.objectContaining({ path: ['SCRYDEX_CLIENT'] }));
});

test.each(['development', 'test'])('static pricing remains available for %s', environment => {
  expect(
    EnvSchema.safeParse({
      NODE_ENV: environment,
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
      BETTER_AUTH_URL: 'http://localhost:8080',
      SCRYDEX_CLIENT: 'static',
    }).success,
  ).toBe(true);
});

test('production accepts live pricing with both credentials', () => {
  expect(
    EnvSchema.safeParse({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
      BETTER_AUTH_URL: 'https://tcg.example.com',
      SCRYDEX_CLIENT: 'real',
      SCRYDEX_API_KEY: 'fixture-key',
      SCRYDEX_TEAM_ID: 'fixture-team',
    }).success,
  ).toBe(true);
});

test.each(['SCRYDEX_API_KEY', 'SCRYDEX_TEAM_ID'])('production rejects missing live credential %s', missing => {
  expect(
    EnvSchema.safeParse({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
      BETTER_AUTH_URL: 'https://tcg.example.com',
      SCRYDEX_CLIENT: 'real',
      SCRYDEX_API_KEY: 'fixture-key',
      SCRYDEX_TEAM_ID: 'fixture-team',
      [missing]: undefined,
    }).success,
  ).toBe(false);
});

test('the production server process exits before serving with static pricing', () => {
  const result = childProcess.spawnSync(process.execPath, ['server/src/index.ts'], {
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
      BETTER_AUTH_URL: 'https://tcg.example.com',
      SCRYDEX_CLIENT: 'static',
    },
    encoding: 'utf8',
    timeout: 10_000,
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Production requires SCRYDEX_CLIENT=real');
});

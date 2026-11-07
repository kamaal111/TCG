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

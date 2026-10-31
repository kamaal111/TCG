import { createApplicationConfig, EnvSchema } from './config.ts';

export { EnvSchema } from './config.ts';

export type { Env } from './config.ts';

const env = EnvSchema.parse(process.env);

export default {
  ...env,
  ...createApplicationConfig(env),
};

import { EnvSchema } from './config.ts';
import { SERVER_MODES } from './constants/common.ts';

export { EnvSchema } from './config.ts';

export type { Env } from './config.ts';

const env = EnvSchema.parse(process.env);

const IS_TEST = env.MODE === SERVER_MODES.TEST;

export default {
  ...env,
  BASE_URL: env.BETTER_AUTH_URL,
  PUBLIC_BASE_URL: env.PUBLIC_BASE_URL ?? env.BETTER_AUTH_URL,
  IS_TEST,
};

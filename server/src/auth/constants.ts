import path from 'node:path';

import env from '../env.ts';
import { APP_API_ROUTE_NAME } from '../constants/common.ts';

export const AUTH_ROUTE_NAME = '/auth';

export const JWKS_PATH = '/jwks';
export const BETTER_AUTH_BASE_PATH = path.join(APP_API_ROUTE_NAME, AUTH_ROUTE_NAME);
export const JWKS_URL = new URL(path.join(env.BETTER_AUTH_URL, BETTER_AUTH_BASE_PATH, JWKS_PATH));

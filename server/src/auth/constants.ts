import path from 'node:path';

import env from '../env.ts';
import { APP_API_ROUTE_NAME } from '../constants/common.ts';

export const AUTH_ROUTE_NAME = '/auth';
export const AUTH_OPENAPI_TAG = 'Authentication';

export const JWKS_PATH = '/jwks';
export const BETTER_AUTH_BASE_PATH = path.join(APP_API_ROUTE_NAME, AUTH_ROUTE_NAME);
export const BETTER_AUTH_BASE_URL = new URL(`${BETTER_AUTH_BASE_PATH}/`, env.BETTER_AUTH_URL);
export const JWKS_URL = new URL(JWKS_PATH.slice(1), BETTER_AUTH_BASE_URL);

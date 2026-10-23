import { AUTH_ROUTE_PATHS } from '@kamaalio/kamaal-auth-hono';

import { APP_API_ROUTE_NAME } from '../constants/common.ts';

export const AUTH_ROUTE_NAME = '/auth';

export const AUTH_OPENAPI_TAG = 'Authentication';

export const JWKS_PATH = '/jwks';

export const BETTER_AUTH_BASE_PATH = `${APP_API_ROUTE_NAME}${AUTH_ROUTE_NAME}`;

/** Absolute paths, for tests and anything addressing these routes from outside the router. */
export const SIGN_UP_ROUTE_PATH = `${BETTER_AUTH_BASE_PATH}${AUTH_ROUTE_PATHS.signUp}` as const;

export const SIGN_IN_ROUTE_PATH = `${BETTER_AUTH_BASE_PATH}${AUTH_ROUTE_PATHS.signIn}` as const;

export const SIGN_OUT_ROUTE_PATH = `${BETTER_AUTH_BASE_PATH}${AUTH_ROUTE_PATHS.signOut}` as const;

export const SESSION_ROUTE_PATH = `${BETTER_AUTH_BASE_PATH}${AUTH_ROUTE_PATHS.session}` as const;

export const TOKEN_ROUTE_PATH = `${BETTER_AUTH_BASE_PATH}${AUTH_ROUTE_PATHS.token}` as const;

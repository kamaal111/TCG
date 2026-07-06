export const REQUEST_ID_HEADER_NAME = 'tcg-request-id';

export const ONE_DAY_IN_SECONDS = 60 * 60 * 24;

export const APP_API_ROUTE_NAME = '/app-api';

export type ServerMode = (typeof SERVER_MODES)[keyof typeof SERVER_MODES];

export const SERVER_MODES = { SERVER: 'SERVER', TEST: 'TEST' } as const;

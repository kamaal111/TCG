export const REQUEST_ID_HEADER_NAME = 'tcg-request-id';
export const SERVER_MODES = { SERVER: 'SERVER', TEST: 'TEST' } as const;

export type ServerMode = (typeof SERVER_MODES)[keyof typeof SERVER_MODES];

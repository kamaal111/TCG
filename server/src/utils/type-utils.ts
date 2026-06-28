export type GetRecordValues<T extends Record<string, unknown>> = T[keyof T];

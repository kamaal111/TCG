export type GetRecordValues<T extends Record<string, unknown>> = T[keyof T];

export type NonEmptyArray<T> = readonly [T, ...T[]];

export function isNonEmpty<T>(items: readonly T[]): items is NonEmptyArray<T> {
  return items.length > 0;
}

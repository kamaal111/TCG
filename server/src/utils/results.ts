import { err, ok, ResultAsync, type Result } from 'neverthrow';

export function tryCatch<T>(callback: () => Promise<T>): ResultAsync<T, unknown>;
export function tryCatch<T>(callback: () => T): Result<T, unknown>;
export function tryCatch<T>(callback: () => T | Promise<T>): Result<T, unknown> | ResultAsync<T, unknown> {
  try {
    const value = callback();
    if (value instanceof Promise) {
      return ResultAsync.fromPromise(value, error => error);
    }

    return ok(value);
  } catch (error) {
    return err(error);
  }
}

export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return new Error(String(value));
}

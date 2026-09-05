export function toISO8601String(date: Date): string {
  return date.toISOString();
}

export function toTypedUpperCase<S extends string>(str: S): Uppercase<S> {
  return str.toUpperCase() as Uppercase<S>;
}

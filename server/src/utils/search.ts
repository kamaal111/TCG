export function literalSubstringPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}

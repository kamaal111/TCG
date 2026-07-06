export function getValueFromSetCookie(headers: Headers, key: string): string | null {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) return null;

  const pattern = new RegExp(`${key}=([^;]+)`);
  const match = setCookie.match(pattern);
  if (!match) return null;

  return match[1] ?? null;
}

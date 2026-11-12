import crypto from 'node:crypto';

export function sha256Hex(value: string | Uint8Array): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

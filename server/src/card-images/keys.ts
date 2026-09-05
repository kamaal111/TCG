import crypto from 'node:crypto';
import path from 'node:path';

import env from '../env.ts';
import { IMAGES_PATH_PREFIX } from './constants.ts';

export function imageKeyForOriginURL(originURL: string): string {
  return crypto.createHash('sha256').update(originURL).digest('hex');
}

export function storageKeyForImageKey(imageKey: string): string {
  return path.join('card-images', imageKey.slice(0, 2), imageKey.slice(2, 4), imageKey);
}

function imageProxyURL(imageKey: string): string {
  return new URL(path.join(IMAGES_PATH_PREFIX, imageKey), env.PUBLIC_BASE_URL).toString();
}

export function proxyURLForOriginURL(originURL: string): string {
  return imageProxyURL(imageKeyForOriginURL(originURL));
}

import crypto from 'node:crypto';
import path from 'node:path';

import { IMAGES_PATH_PREFIX } from './constants.ts';

export function imageKeyForOriginURL(originURL: string): string {
  return crypto.createHash('sha256').update(originURL).digest('hex');
}

export function storageKeyForImageKey(imageKey: string): string {
  return path.join('card-images', imageKey.slice(0, 2), imageKey.slice(2, 4), imageKey);
}

function imageProxyURL(imageKey: string, baseURL: string): string {
  return new URL(path.join(IMAGES_PATH_PREFIX, imageKey), baseURL).toString();
}

export function proxyURLForOriginURL(originURL: string, baseURL: string): string {
  return imageProxyURL(imageKeyForOriginURL(originURL), baseURL);
}

import path from 'node:path';

import { sha256Hex } from '@tcg/crypto/sha256';

import { IMAGES_PATH_PREFIX } from './constants.ts';

export function imageKeyForOriginURL(originURL: string): string {
  return sha256Hex(originURL);
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

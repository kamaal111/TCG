import type { CardImageRow, ClaimedCardImageRow } from './types.ts';

export type { CardImageRow, ClaimedCardImageRow } from './types.ts';

/** Claims are atomic; lease owners fence every completion. */
export interface CardImageRepository {
  getByImageKey(imageKey: string): Promise<CardImageRow | undefined>;
  registerMany(values: { imageKey: string; originUrl: string; storageKey: string }[]): Promise<CardImageRow[]>;
  claim(imageKey: string, leaseOwner: string, now?: Date): Promise<CardImageRow | undefined>;
  claimBatch(leaseOwner: string, limit: number, now?: Date): Promise<ClaimedCardImageRow[]>;
  releaseClaim(imageKey: string, leaseOwner: string): Promise<boolean>;
  markReady(
    imageKey: string,
    leaseOwner: string,
    values: { contentType: string; contentLength: number; checksum: string },
  ): Promise<boolean>;
  markFailed(
    imageKey: string,
    leaseOwner: string,
    failure: { code: string; message: string; isRetryable: boolean; attemptCount: number },
  ): Promise<boolean>;
  findReadyImageKeysByOriginUrlPattern(pattern: string): Promise<Pick<CardImageRow, 'imageKey'>[]>;
  requeueForRefresh(imageKeys: string[]): Promise<number>;
  resetMissingObject(imageKey: string): Promise<void>;
}

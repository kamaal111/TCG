import crypto from 'node:crypto';

import { ok } from 'neverthrow';

import type { cardImage } from '../../db/schema/card-images.ts';
import { deferred } from '../../tests/async.ts';
import type { CardImageOriginClient, CardImageOriginResult } from '../origin-client.ts';

export function imageRecord(overrides: Partial<typeof cardImage.$inferInsert> = {}): typeof cardImage.$inferInsert {
  const imageKey = overrides.imageKey ?? crypto.randomBytes(32).toString('hex');

  return {
    imageKey,
    originUrl: `https://images.example.com/${imageKey}.png`,
    storageKey: `card-images/${imageKey}`,
    ...overrides,
  };
}

export class GatedImageOriginClient implements CardImageOriginClient {
  private readonly releaseGate = deferred<undefined>();
  private readonly startedGate = deferred<undefined>();
  callCount = 0;
  readonly started = this.startedGate.promise;

  async fetchImage(): Promise<CardImageOriginResult> {
    this.callCount += 1;
    this.startedGate.resolve(undefined);
    await this.releaseGate.promise;

    return ok({ body: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
  }

  release(): void {
    this.releaseGate.resolve(undefined);
  }
}

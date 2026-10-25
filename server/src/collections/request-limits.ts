import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { COLLECTION_BUFFER_BYTES } from './constants.ts';
import { CollectionCapacityBusy, CollectionRequestTimeout, CollectionRequestTooLarge } from './exceptions.ts';
import type { CollectionPolicy } from './types.ts';
import type { HonoEnvironment } from '../context.ts';

const EnvelopeSchema = z.object({
  collection_ids: z.array(z.unknown()).optional().catch(undefined),
  collections: z.array(z.unknown()).optional().catch(undefined),
  cards: z.array(z.unknown()).optional().catch(undefined),
  pages: z.array(z.unknown()).optional().catch(undefined),
});

const CollectionEnvelopeSchema = z.object({ pages: z.array(z.unknown()).optional().catch(undefined) });

const PageEnvelopeSchema = z.object({ slots: z.array(z.unknown()) });

const CardEnvelopeSchema = z.object({ purchases: z.array(z.unknown()).optional().catch(undefined) });

function checkCounts(data: z.infer<typeof EnvelopeSchema>, policy: CollectionPolicy) {
  if (
    (data.collection_ids?.length ?? 0) > policy.COLLECTION_MAX_COLLECTIONS ||
    (data.collections?.length ?? 0) > policy.COLLECTION_MAX_COLLECTIONS ||
    (data.cards?.length ?? 0) > policy.COLLECTION_MAX_CARDS
  ) {
    throw new CollectionRequestTooLarge();
  }

  let pageCount = 0;
  let slotCount = 0;
  let purchaseCount = 0;

  const countPages = (entries: NonNullable<typeof data.pages>) => {
    pageCount += entries.length;

    if (pageCount > policy.COLLECTION_MAX_PAGES) {
      throw new CollectionRequestTooLarge();
    }

    for (const entry of entries) {
      const page = PageEnvelopeSchema.safeParse(entry);

      if (page.success) {
        slotCount += page.data.slots.length;

        if (slotCount > policy.COLLECTION_MAX_SLOTS) {
          throw new CollectionRequestTooLarge();
        }
      }
    }
  };

  countPages(data.pages ?? []);

  for (const entry of data.collections ?? []) {
    const collection = CollectionEnvelopeSchema.safeParse(entry);

    if (collection.success) {
      countPages(collection.data.pages ?? []);
    }
  }

  for (const entry of data.cards ?? []) {
    const card = CardEnvelopeSchema.safeParse(entry);

    if (card.success) {
      purchaseCount += card.data.purchases?.length ?? 0;

      if (purchaseCount > policy.COLLECTION_MAX_PURCHASES) {
        throw new CollectionRequestTooLarge();
      }
    }
  }
}

export function collectionRequestLimits(policy: CollectionPolicy): MiddlewareHandler<HonoEnvironment> {
  let reading = 0;

  return async (c, next) => {
    if (c.req.raw.body == null) {
      return next();
    }

    if (reading >= policy.COLLECTION_CONCURRENCY) {
      throw new CollectionCapacityBusy();
    }

    reading += 1;
    const reader = c.req.raw.body.getReader();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => undefined);
    }, policy.COLLECTION_BODY_TIMEOUT_MS);

    try {
      let buffer = Buffer.allocUnsafe(Math.min(policy.COLLECTION_MAX_BODY_BYTES, COLLECTION_BUFFER_BYTES));
      let size = 0;

      while (true) {
        const chunk = await reader.read();

        if (timedOut) {
          throw new CollectionRequestTimeout();
        }

        if (chunk.done) {
          break;
        }

        const nextSize = size + chunk.value.byteLength;

        if (nextSize > policy.COLLECTION_MAX_BODY_BYTES) {
          throw new CollectionRequestTooLarge();
        }

        if (nextSize > buffer.byteLength) {
          const grown = Buffer.allocUnsafe(
            Math.min(policy.COLLECTION_MAX_BODY_BYTES, Math.max(nextSize, buffer.byteLength * 2)),
          );

          buffer.copy(grown, 0, 0, size);
          buffer = grown;
        }

        buffer.set(chunk.value, size);
        size = nextSize;
      }

      const body = buffer.subarray(0, size);
      let envelope: z.infer<typeof EnvelopeSchema> | undefined;

      try {
        const parsed = EnvelopeSchema.safeParse(JSON.parse(body.toString('utf8')));

        if (parsed.success) {
          envelope = parsed.data;
        }
      } catch {
        // The route validator owns malformed JSON responses.
      }

      if (envelope != null) {
        checkCounts(envelope, policy);
      }

      c.req.raw = new Request(c.req.raw, { method: c.req.method, body });
    } finally {
      clearTimeout(timer);
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
      reading -= 1;
    }

    await next();
  };
}

import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ECB_FEED_URL, FOREX_BASE_CURRENCY, FOREX_REQUEST_TIMEOUT_MS } from './constants.ts';
import { CurrencySchema } from './currencies.ts';
import { ForexSnapshotSchema, type ForexSnapshot } from './schemas/responses.ts';
import { toError, tryCatch } from '../utils/results.ts';

const FeedSchema = z.object({
  Envelope: z.object({
    Cube: z.object({
      Cube: z.object({
        time: z.iso.date(),
        Cube: z.array(z.object({ currency: z.string(), rate: z.coerce.number().positive() })).min(1),
      }),
    }),
  }),
});

export interface ForexClient {
  latestSnapshot(): Promise<Result<ForexSnapshot, Error>>;
}

export class EcbForexClient implements ForexClient {
  private readonly fetchImplementation: typeof fetch;

  constructor(options: { fetch?: typeof fetch } = {}) {
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async latestSnapshot(): Promise<Result<ForexSnapshot, Error>> {
    return tryCatch(async () => {
      const response = await this.fetchImplementation(ECB_FEED_URL, {
        signal: AbortSignal.timeout(FOREX_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`ECB request failed: HTTP ${response.status}`);
      }

      const xml = await response.text();

      SyntaxValidator.validate(xml);

      const raw: unknown = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        removeNSPrefix: true,
      }).parse(xml);

      const day = FeedSchema.parse(raw).Envelope.Cube.Cube;

      const rates: ForexSnapshot['rates'] = { [FOREX_BASE_CURRENCY]: 1 };

      for (const item of day.Cube) {
        const currency = CurrencySchema.safeParse(item.currency);

        if (!currency.success) {
          continue;
        }

        if (rates[currency.data] != null) {
          throw new Error('Duplicate ECB currency');
        }

        rates[currency.data] = item.rate;
      }

      return ForexSnapshotSchema.parse({ base: FOREX_BASE_CURRENCY, date: day.time, rates });
    }).mapErr(toError);
  }
}

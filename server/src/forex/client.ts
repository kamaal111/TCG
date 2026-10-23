import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { ECB_FEED_URL, FOREX_BASE_CURRENCY, FOREX_REQUEST_TIMEOUT_MS } from './constants.ts';
import { CurrencySchema } from './currencies.ts';
import { ForexInvalidResponse, ForexRequestFailed, type ForexError } from './errors.ts';
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
  latestSnapshot(): Promise<Result<ForexSnapshot, ForexError>>;
}

export class EcbForexClient implements ForexClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
  });

  constructor(options: { fetch?: typeof fetch } = {}) {
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async latestSnapshot(): Promise<Result<ForexSnapshot, ForexError>> {
    const feed = await this.fetchFeed();

    if (feed.isErr()) {
      return err(feed.error);
    }

    return tryCatch(() => {
      const xml = feed.value;
      SyntaxValidator.validate(xml);

      const raw: unknown = this.parser.parse(xml);

      const day = FeedSchema.parse(raw).Envelope.Cube.Cube;

      const rates: ForexSnapshot['rates'] = { [FOREX_BASE_CURRENCY]: 1 };

      for (const item of day.Cube) {
        const currency = CurrencySchema.safeParse(item.currency);

        if (!currency.success) {
          continue;
        }

        if (rates[currency.data] != null) {
          throw new ForexInvalidResponse('Duplicate ECB currency');
        }

        rates[currency.data] = item.rate;
      }

      return ForexSnapshotSchema.parse({ base: FOREX_BASE_CURRENCY, date: day.time, rates });
    }).mapErr(cause => new ForexInvalidResponse(toError(cause).message, { cause }));
  }

  private async fetchFeed(): Promise<Result<string, ForexError>> {
    return tryCatch(async () => {
      const response = await this.fetchImplementation(ECB_FEED_URL, {
        signal: AbortSignal.timeout(FOREX_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new ForexRequestFailed(`ECB request failed: HTTP ${response.status}`, { statusCode: response.status });
      }

      return response.text();
    }).mapErr(cause =>
      cause instanceof ForexRequestFailed ? cause : new ForexRequestFailed('ECB request failed', { cause }),
    );
  }
}

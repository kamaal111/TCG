import { err, ok } from 'neverthrow';

import {
  ScrydexCardResponseSchema,
  ScrydexRawCardSchema,
  ScrydexSearchResponseSchema,
  type ScrydexRawCard,
} from './schemas.ts';
import type { ScrydexGame, ScrydexClientResult, ScrydexSearchResult, ScrydexLookupResult } from './types.ts';
import { SCRYDEX_ERROR_REASONS } from './types.ts';

export type ScrydexFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ScrydexClientOptions {
  apiKey?: string;
  baseURL?: string;
  fetch?: ScrydexFetch;
  requestTimeoutMs?: number;
  teamId?: string;
}

export class ScrydexClient {
  private readonly apiKey: string | undefined;
  private readonly baseURL: string;
  private readonly fetchImplementation: ScrydexFetch;
  private readonly requestTimeoutMs: number;
  private readonly teamId: string | undefined;

  constructor(options: ScrydexClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseURL = options.baseURL ?? 'https://api.scrydex.com';
    this.fetchImplementation = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8_000;
    this.teamId = options.teamId;
  }

  async searchCards(game: ScrydexGame, query: string): Promise<ScrydexClientResult<ScrydexSearchResult>> {
    const headers = this.headers();

    if (headers.isErr()) {
      return err(headers.error);
    }

    const url = this.makeURL(game, '/cards');
    url.searchParams.set('q', query);
    url.searchParams.set('include', 'prices');
    url.searchParams.set('page', '1');
    url.searchParams.set('page_size', '20');
    const responseResult = await this.request(url, headers.value);

    if (responseResult.isErr()) {
      return err(responseResult.error);
    }

    const response = responseResult.value;

    if (!response.ok) {
      return err(this.httpError('search', response.status));
    }

    const bodyResult = await this.readJSON(response, 'search');

    if (bodyResult.isErr()) {
      return err(bodyResult.error);
    }

    const parsed = ScrydexSearchResponseSchema.safeParse(bodyResult.value);

    if (!parsed.success) {
      return err(this.invalidResponse('Scrydex search returned an invalid response', response.status));
    }

    const cards: ScrydexRawCard[] = [];
    let rejectedCount = 0;

    for (const value of parsed.data.data) {
      const raw = ScrydexRawCardSchema.safeParse(value);

      if (!raw.success) {
        rejectedCount += 1;
        continue;
      }

      cards.push(raw.data);
    }

    return ok({
      cards,
      providerResultCount: parsed.data.totalCount ?? parsed.data.total_count ?? parsed.data.data.length,
      rejectedCount,
    });
  }

  async getCardById(game: ScrydexGame, id: string): Promise<ScrydexClientResult<ScrydexLookupResult | null>> {
    const headers = this.headers();

    if (headers.isErr()) {
      return err(headers.error);
    }

    const url = this.makeURL(game, `/cards/${encodeURIComponent(id)}`);
    url.searchParams.set('include', 'prices');
    const responseResult = await this.request(url, headers.value);

    if (responseResult.isErr()) {
      return err(responseResult.error);
    }

    const response = responseResult.value;

    if (response.status === 404) {
      return ok(null);
    }

    if (!response.ok) {
      return err(this.httpError('card lookup', response.status));
    }

    const bodyResult = await this.readJSON(response, 'card lookup');

    if (bodyResult.isErr()) {
      return err(bodyResult.error);
    }

    const envelope = ScrydexCardResponseSchema.safeParse(bodyResult.value);

    if (!envelope.success) {
      return err(this.invalidResponse('Scrydex card lookup returned an invalid response', response.status));
    }

    return ok({ card: envelope.data.data, statusCode: response.status });
  }

  private headers(): ScrydexClientResult<HeadersInit> {
    if (this.apiKey == null || this.teamId == null) {
      return err({
        reason: SCRYDEX_ERROR_REASONS.MISSING_CREDENTIALS,
        message: 'SCRYDEX_API_KEY and SCRYDEX_TEAM_ID are required for the real Scrydex client',
        isRetryable: false,
      });
    }

    return ok({ 'X-Api-Key': this.apiKey, 'X-Team-ID': this.teamId });
  }

  private async request(url: URL, headers: HeadersInit): Promise<ScrydexClientResult<Response>> {
    try {
      return ok(
        await this.fetchImplementation(url, {
          headers,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        }),
      );
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

      return err({
        reason: timedOut ? SCRYDEX_ERROR_REASONS.REQUEST_TIMEOUT : SCRYDEX_ERROR_REASONS.NETWORK_ERROR,
        message: timedOut ? 'Scrydex request timed out' : 'Scrydex request failed before a response was received',
        isRetryable: true,
      });
    }
  }

  private async readJSON(response: Response, operation: string): Promise<ScrydexClientResult<unknown>> {
    try {
      return ok(await response.json());
    } catch {
      return err(this.invalidResponse(`Scrydex ${operation} returned invalid JSON`, response.status));
    }
  }

  private makeURL(game: ScrydexGame, suffix: string): URL {
    const path = game === 'pokemon' ? 'pokemon/v1' : 'onepiece/v1';

    return new URL(`${path}${suffix}`, `${this.baseURL.replace(/\/$/, '')}/`);
  }

  private httpError(operation: string, statusCode: number) {
    return {
      reason: SCRYDEX_ERROR_REASONS.HTTP_ERROR,
      message: `Scrydex ${operation} failed with status ${statusCode}`,
      statusCode,
      isRetryable: statusCode === 429 || statusCode >= 500,
    } as const;
  }

  private invalidResponse(message: string, statusCode: number) {
    return {
      reason: SCRYDEX_ERROR_REASONS.INVALID_RESPONSE,
      message,
      statusCode,
      isRetryable: false,
    } as const;
  }
}

import { err, ok } from 'neverthrow';

import { STATUS_CODES } from '../../constants/http.ts';
import env from '../../env.ts';
import {
  type PricingClient,
  type PricingClientResult,
  PRICING_CLIENT_ERROR_REASONS,
  type PricingSearchResult,
} from '../client.ts';
import { CARD_GAME_MAP, type CardGame, type PricingCardRecord, PRICING_SOURCES } from '../types.ts';
import { normalizeScrydexCard } from './normalize.ts';
import { buildScrydexQuery } from './query.ts';
import { ScrydexRawCardSchema, ScrydexSearchResponseSchema } from './types.ts';

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface RealScrydexClientOptions {
  apiKey?: string;
  baseURL?: string;
  fetch?: Fetch;
  requestTimeoutMs?: number;
  teamId?: string;
}

export class RealScrydexClient implements PricingClient {
  readonly source = PRICING_SOURCES.SCRYDEX_REAL;

  private readonly apiKey: string | undefined;
  private readonly baseURL: string;
  private readonly fetchImplementation: Fetch;
  private readonly requestTimeoutMs: number;
  private readonly teamId: string | undefined;

  constructor(options: RealScrydexClientOptions = {}) {
    this.apiKey = options.apiKey ?? env.SCRYDEX_API_KEY;
    this.baseURL = options.baseURL ?? env.SCRYDEX_BASE_URL;
    this.fetchImplementation = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? env.SCRYDEX_REQUEST_TIMEOUT_MS;
    this.teamId = options.teamId ?? env.SCRYDEX_TEAM_ID;
  }

  async searchCards(game: CardGame, query: string): Promise<PricingClientResult<PricingSearchResult>> {
    const headers = this.headers();
    if (headers.isErr()) return err(headers.error);

    const url = this.makeURL(game, '/cards');
    url.searchParams.set('q', buildScrydexQuery(game, query));
    url.searchParams.set('include', 'prices');
    url.searchParams.set('page', '1');
    url.searchParams.set('page_size', '20');
    const responseResult = await this.request(url, headers.value);
    if (responseResult.isErr()) return err(responseResult.error);
    const response = responseResult.value;
    if (!response.ok) return err(this.httpError('search', response.status));

    const bodyResult = await this.readJSON(response, 'search');
    if (bodyResult.isErr()) return err(bodyResult.error);
    const parsed = ScrydexSearchResponseSchema.safeParse(bodyResult.value);
    if (!parsed.success)
      return err(this.invalidResponse('Scrydex search returned an invalid response', response.status));

    const records: PricingCardRecord[] = [];
    let rejectedCount = 0;
    let missingBaseVariantCount = 0;
    for (const value of parsed.data.data) {
      const raw = ScrydexRawCardSchema.safeParse(value);
      if (!raw.success) {
        rejectedCount += 1;
        continue;
      }
      const normalized = normalizeScrydexCard(game, raw.data);
      if (normalized == null) {
        rejectedCount += 1;
        continue;
      }
      if (!normalized.hasBaseVariant) missingBaseVariantCount += 1;
      records.push({ card: normalized.card, raw: raw.data });
    }

    return ok({
      records,
      providerResultCount: parsed.data.totalCount ?? parsed.data.total_count ?? parsed.data.data.length,
      rejectedCount,
      missingBaseVariantCount,
    });
  }

  async getCardById(game: CardGame, id: string): Promise<PricingClientResult<PricingCardRecord | null>> {
    const headers = this.headers();
    if (headers.isErr()) return err(headers.error);

    const url = this.makeURL(game, `/cards/${encodeURIComponent(id)}`);
    url.searchParams.set('include', 'prices');
    const responseResult = await this.request(url, headers.value);
    if (responseResult.isErr()) return err(responseResult.error);
    const response = responseResult.value;
    if (response.status === STATUS_CODES.NOT_FOUND) return ok(null);
    if (!response.ok) return err(this.httpError('card lookup', response.status));

    const bodyResult = await this.readJSON(response, 'card lookup');
    if (bodyResult.isErr()) return err(bodyResult.error);
    const raw = ScrydexRawCardSchema.safeParse(bodyResult.value);
    if (!raw.success)
      return err(this.invalidResponse('Scrydex card lookup returned an invalid response', response.status));
    const normalized = normalizeScrydexCard(game, raw.data);
    if (normalized == null)
      return err(this.invalidResponse('Scrydex card lookup returned an unusable card', response.status));
    return ok({ card: normalized.card, raw: raw.data });
  }

  private headers(): PricingClientResult<HeadersInit> {
    if (this.apiKey == null || this.teamId == null) {
      return err({
        reason: PRICING_CLIENT_ERROR_REASONS.MISSING_CREDENTIALS,
        message: 'SCRYDEX_API_KEY and SCRYDEX_TEAM_ID are required for the real Scrydex client',
        isRetryable: false,
      });
    }
    return ok({ 'X-Api-Key': this.apiKey, 'X-Team-ID': this.teamId });
  }

  private async request(url: URL, headers: HeadersInit): Promise<PricingClientResult<Response>> {
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
        reason: timedOut ? PRICING_CLIENT_ERROR_REASONS.REQUEST_TIMEOUT : PRICING_CLIENT_ERROR_REASONS.NETWORK_ERROR,
        message: timedOut ? 'Scrydex request timed out' : 'Scrydex request failed before a response was received',
        isRetryable: true,
      });
    }
  }

  private async readJSON(response: Response, operation: string): Promise<PricingClientResult<unknown>> {
    try {
      return ok(await response.json());
    } catch {
      return err(this.invalidResponse(`Scrydex ${operation} returned invalid JSON`, response.status));
    }
  }

  private makeURL(game: CardGame, suffix: string): URL {
    const path = game === CARD_GAME_MAP.POKEMON ? 'pokemon/v1/en' : 'onepiece/v1';
    return new URL(`${path}${suffix}`, `${this.baseURL.replace(/\/$/, '')}/`);
  }

  private httpError(operation: string, statusCode: number) {
    return {
      reason: PRICING_CLIENT_ERROR_REASONS.HTTP_ERROR,
      message: `Scrydex ${operation} failed with status ${statusCode}`,
      statusCode,
      isRetryable: statusCode === 429 || statusCode >= 500,
    } as const;
  }

  private invalidResponse(message: string, statusCode?: number) {
    return {
      reason: PRICING_CLIENT_ERROR_REASONS.INVALID_RESPONSE,
      message,
      statusCode,
      isRetryable: false,
    } as const;
  }
}

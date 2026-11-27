import { err, ok } from 'neverthrow';

import {
  ScrydexCardResponseSchema,
  ScrydexRawCardSchema,
  ScrydexSearchResponseSchema,
  type ScrydexRawCard,
} from './schemas.ts';
import {
  SCRYDEX_CATALOG_COLLECTION_MAP,
  SCRYDEX_ERROR_REASONS,
  SCRYDEX_GAME_MAP,
  SCRYDEX_SEARCH_PAGE_SIZE,
  type ScrydexCatalogCollection,
  type ScrydexClientResult,
  type ScrydexGame,
  type ScrydexLookupResult,
  type ScrydexSearchResult,
} from './types.ts';

const SCRYDEX_OPERATION_MAP = {
  SEARCH: 'search',
  CARD_LOOKUP: 'card lookup',
} as const;

export type ScrydexFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const CARD_INCLUDES = {
  [SCRYDEX_GAME_MAP.POKEMON]: 'prices,pop_reports',
  [SCRYDEX_GAME_MAP.ONE_PIECE]: 'prices',
} satisfies Record<ScrydexGame, string>;

const CATALOG_FIELDS = {
  [SCRYDEX_CATALOG_COLLECTION_MAP.CARDS]: 'id,name,number,printed_number,language_code,expansion,translation,variants',
  [SCRYDEX_CATALOG_COLLECTION_MAP.EXPANSIONS]: 'id,name,code,translation',
} satisfies Record<ScrydexCatalogCollection, string>;

const SET_FIELDS = {
  [SCRYDEX_CATALOG_COLLECTION_MAP.CARDS]: 'images',
  [SCRYDEX_CATALOG_COLLECTION_MAP.EXPANSIONS]: 'language_code,release_date,logo,symbol',
} satisfies Record<ScrydexCatalogCollection, string>;

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

  constructor(options: ScrydexClientOptions) {
    this.apiKey = options.apiKey;
    this.baseURL = options.baseURL ?? 'https://api.scrydex.com';
    this.fetchImplementation = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8_000;
    this.teamId = options.teamId;
  }

  async searchCards(game: ScrydexGame, query: string, page: number): Promise<ScrydexClientResult<ScrydexSearchResult>> {
    return this.list(game, SCRYDEX_CATALOG_COLLECTION_MAP.CARDS, page, {
      q: query,
      include: CARD_INCLUDES[game],
    });
  }

  listCatalog(game: ScrydexGame, collection: ScrydexCatalogCollection, query: string, page: number) {
    return this.list(game, collection, page, {
      q: query,
      orderBy: 'id',
      select: CATALOG_FIELDS[collection],
    });
  }

  listSetCatalog(game: ScrydexGame, collection: ScrydexCatalogCollection, page: number) {
    return this.list(game, collection, page, {
      orderBy: 'id',
      select: `${CATALOG_FIELDS[collection]},${SET_FIELDS[collection]}`,
    });
  }

  private async list(
    game: ScrydexGame,
    collection: ScrydexCatalogCollection,
    page: number,
    parameters: Record<string, string>,
  ): Promise<ScrydexClientResult<ScrydexSearchResult>> {
    const headers = this.headers();

    if (headers.isErr()) {
      return err(headers.error);
    }

    const url = this.makeURL(game, `/${collection}`);
    url.search = new URLSearchParams({
      ...parameters,
      page: String(page),
      page_size: String(SCRYDEX_SEARCH_PAGE_SIZE),
    }).toString();
    const responseResult = await this.request(url, headers.value);

    if (responseResult.isErr()) {
      return err(responseResult.error);
    }

    const response = responseResult.value;

    if (!response.ok) {
      return err(this.httpError(SCRYDEX_OPERATION_MAP.SEARCH, response.status));
    }

    const bodyResult = await this.readJSON(response, SCRYDEX_OPERATION_MAP.SEARCH);

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

    const total = parsed.data.totalCount ?? parsed.data.total_count;
    const rawCount = parsed.data.data.length;

    const result: ScrydexSearchResult = {
      cards,
      providerResultCount: total ?? rawCount,
      hasMore:
        rawCount > 0 &&
        (total == null ? rawCount === SCRYDEX_SEARCH_PAGE_SIZE : page * SCRYDEX_SEARCH_PAGE_SIZE < total),
      rejectedCount,
    };

    return ok(parameters.include == null ? { ...result, catalogTotal: total } : result);
  }

  async getCardById(game: ScrydexGame, id: string): Promise<ScrydexClientResult<ScrydexLookupResult | null>> {
    const headers = this.headers();

    if (headers.isErr()) {
      return err(headers.error);
    }

    const url = this.makeURL(game, `/${SCRYDEX_CATALOG_COLLECTION_MAP.CARDS}/${encodeURIComponent(id)}`);
    url.searchParams.set('include', CARD_INCLUDES[game]);
    const responseResult = await this.request(url, headers.value);

    if (responseResult.isErr()) {
      return err(responseResult.error);
    }

    const response = responseResult.value;

    if (response.status === 404) {
      return ok(null);
    }

    if (!response.ok) {
      return err(this.httpError(SCRYDEX_OPERATION_MAP.CARD_LOOKUP, response.status));
    }

    const bodyResult = await this.readJSON(response, SCRYDEX_OPERATION_MAP.CARD_LOOKUP);

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
    const path = game === SCRYDEX_GAME_MAP.POKEMON ? 'pokemon/v1' : 'onepiece/v1';

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

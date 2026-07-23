import type { Env } from '../../env.ts';
import type { TCGGOClient } from './client.ts';
import type { CardGame, TCGGORawCard } from './types.ts';

export class RealTCGGOClient implements TCGGOClient {
  readonly source = 'real' as const;
  private readonly config: Pick<
    Env,
    'TCGGO_API_KEY' | 'TCGGO_API_HOST' | 'TCGGO_BASE_URL' | 'TCGGO_ONE_PIECE_PATH' | 'TCGGO_REQUEST_TIMEOUT_MS'
  >;

  constructor(
    config: Pick<
      Env,
      'TCGGO_API_KEY' | 'TCGGO_API_HOST' | 'TCGGO_BASE_URL' | 'TCGGO_ONE_PIECE_PATH' | 'TCGGO_REQUEST_TIMEOUT_MS'
    >,
  ) {
    this.config = config;
  }

  async searchCards(game: CardGame, query: string): Promise<TCGGORawCard[]> {
    const url = this.makeURL(game, '/cards');
    url.searchParams.set('search', query);
    const response = await fetch(url, { headers: this.headers, signal: this.requestSignal });
    if (!response.ok) throw new Error(`TCGGO search failed with status ${response.status}`);

    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error('TCGGO search returned a non-array response');

    return body.filter(isRawCard);
  }

  async getCardById(game: CardGame, id: string): Promise<TCGGORawCard | null> {
    const response = await fetch(this.makeURL(game, `/cards/${encodeURIComponent(id)}`), {
      headers: this.headers,
      signal: this.requestSignal,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`TCGGO card lookup failed with status ${response.status}`);

    const body: unknown = await response.json();
    if (!isRawCard(body)) throw new Error('TCGGO card lookup returned an invalid response');

    return body;
  }

  private get headers(): HeadersInit {
    const apiKey = this.config.TCGGO_API_KEY;
    if (apiKey == null) throw new Error('TCGGO_API_KEY is required for the real TCGGO client');

    return {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': this.config.TCGGO_API_HOST,
    };
  }

  private get requestSignal(): AbortSignal {
    return AbortSignal.timeout(this.config.TCGGO_REQUEST_TIMEOUT_MS);
  }

  private makeURL(game: CardGame, suffix: string): URL {
    const path = game === 'pokemon' ? 'pokemon' : this.config.TCGGO_ONE_PIECE_PATH;
    return new URL(`${path}${suffix}`, `${this.config.TCGGO_BASE_URL.replace(/\/$/, '')}/`);
  }
}

function isRawCard(value: unknown): value is TCGGORawCard {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

import assert from 'node:assert/strict';

import type { ScrydexRawCard } from '@tcg/scrydex';

import { createTestScrydexClient } from './utils.ts';
import { ApplicationConfigSchema } from '../../config.ts';
import { PRICING_CLIENT_MODES } from '../../constants/common.ts';
import { PostgresCardCatalog } from '../../persistence/postgres/card-catalog.ts';
import { sessionHeaders } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { CardCatalog, CATALOG_BUILD_STATUS_MAP } from '../catalog.ts';
import { SEARCH_PRICING_ROUTE_PATH } from '../routes/search-pricing.ts';
import { PricingSearchResponseSchema } from '../schemas/responses.ts';
import { CARD_GAME_MAP, PRICING_SEARCH_MODE_MAP, type CardGame } from '../types.ts';

const VSTAR = { id: 'swsh12a_ja', code: 'S12A', name: 'VSTAR Universe' };
const VS = { id: 'vs1_ja', name: 'Pokémon VS' };
const MAGMA = { id: 'ex4', name: 'Team Magma vs Team Aqua' };
const WILD_FORCE = { id: 'sv5m_ja', name: 'ワイルドフォース', translation: { en: { name: 'Wild Force' } } };
const SET_151 = { id: 'sv3pt5', name: '151' };
const ROMANCE = { id: 'OP01', name: 'Romance Dawn' };
const HEROINES = { id: 'EB05', name: 'Heroines Edition Vol.2' };

const ENTEI_CARDS = [
  pokemonCard(VSTAR, '19', '019/172', 'エンテイV', 'JA', 'Entei V'),
  pokemonCard(VSTAR, '213', '213/172', 'エンテイV', 'JA', 'Entei V'),
  pokemonCard(VS, '95', '095/141', 'ロケット団のエンテイ', 'JA', 'Rocket’s Entei'),
  pokemonCard(MAGMA, '91', '91/95', 'Entei ex', 'EN', undefined),
];

const SHIFTRY = pokemonCard(WILD_FORCE, '72', '072/071', 'ダーテング', 'JA', 'Shiftry');
const CHARIZARD = pokemonCard(SET_151, '199', '199/165', 'Charizard ex', 'EN', undefined);
const UNRELATED = pokemonCard(SET_151, '25', '025/165', 'Entei', 'EN', undefined);

const NAMI = {
  id: 'OP01-016',
  name: 'Nami',
  number: '16',
  printed_number: 'OP01-016',
  expansion: ROMANCE,
  language_code: 'EN',
  variants: [
    { name: 'foil', printings: ['OP01'] },
    { name: 'altArt', printings: ['EB05'] },
  ],
} satisfies ScrydexRawCard;

const config = ApplicationConfigSchema.parse({
  BETTER_AUTH_URL: 'http://localhost:8080',
  SCRYDEX_CLIENT: PRICING_CLIENT_MODES.REAL,
  CARD_IMAGE_WORKER_ENABLED: false,
  MODE: 'TEST',
});

describe('Catalog search through the authenticated pricing API', () => {
  integrationTest(
    'shares the first build across replicas and searches new terms across names and sets',
    async ({ createApp, user }) => {
      const feed = new CatalogTransport();
      const requested = Promise.withResolvers<undefined>();
      const resume = Promise.withResolvers<undefined>();
      feed.pause = () => {
        requested.resolve(undefined);

        return resume.promise;
      };

      const first = createApp({ config, pricingClient: createTestScrydexClient(feed.fetch, {}) });
      const second = createApp({ config, pricingClient: createTestScrydexClient(feed.fetch, {}) });
      const search = searchAs(user.sessionToken);
      const firstResponse = search(first, 'entei vs', CARD_GAME_MAP.POKEMON);
      await requested.promise;
      const secondResponse = search(second, 'entei vs', CARD_GAME_MAP.POKEMON);
      resume.resolve(undefined);

      const [firstPage, secondPage] = await Promise.all([page(firstResponse), page(secondResponse)]);
      expect(firstPage.entries.map(card => card.card_number)).toEqual(['91/95', '095/141', '019/172', '213/172']);
      expect(secondPage.entries).toEqual(firstPage.entries);
      expect(feed.metadataRequests).toBe(2);
      expect(feed.priceRequests).toBe(1);

      const japanese = await page(search(second, 'entei vs', CARD_GAME_MAP.POKEMON, { languages: 'ja' }));
      expect(japanese.entries.map(card => card.card_number)).toEqual(['095/141', '019/172', '213/172']);
      expect(
        (await page(search(first, 'vs entei', CARD_GAME_MAP.POKEMON))).entries.map(card => card.card_number),
      ).toEqual(['91/95', '095/141']);
      expect(
        (await page(search(first, 'entei vs', CARD_GAME_MAP.POKEMON, { languages: 'en' }))).entries.map(
          card => card.card_number,
        ),
      ).toEqual(['91/95']);
      expect(
        (await page(search(first, "Pokemon Rocket's Entei", CARD_GAME_MAP.POKEMON))).entries.map(
          card => card.card_number,
        ),
      ).toEqual(['095/141']);
      expect(
        (await page(search(first, 'エンテイV vstar', CARD_GAME_MAP.POKEMON))).entries.map(card => card.card_number),
      ).toEqual(['019/172', '213/172']);
      expect((await page(search(first, 'entei paradox', CARD_GAME_MAP.POKEMON))).entries).toEqual([]);
      expect(feed.priceRequests).toBe(1);

      expect(
        (await page(search(first, 'charizard 151', CARD_GAME_MAP.POKEMON))).entries.map(card => card.card_number),
      ).toEqual(['199/165']);
      expect(
        (await page(search(first, 'sv5m 072/071', CARD_GAME_MAP.POKEMON))).entries.map(card => card.card_number),
      ).toEqual(['072/071']);
      expect(
        (await page(search(first, 'shiftry wild', CARD_GAME_MAP.POKEMON))).entries.map(card => card.card_number),
      ).toEqual(['072/071']);
    },
  );

  integrationTest('keeps set-specific One Piece artwork and exact lookups', async ({ createApp, user }) => {
    const feed = new CatalogTransport();
    const app = createApp({ config, pricingClient: createTestScrydexClient(feed.fetch, {}) });
    const search = searchAs(user.sessionToken);

    expect((await page(search(app, 'nami rom', CARD_GAME_MAP.ONE_PIECE))).entries).toMatchObject([
      { card_number: 'OP01-016', variant_name: 'foil', set_name: 'Romance Dawn' },
    ]);
    expect((await page(search(app, 'nami heroines', CARD_GAME_MAP.ONE_PIECE))).entries).toMatchObject([
      { card_number: 'OP01-016', variant_name: 'altArt', set_name: 'Heroines Edition Vol.2' },
    ]);
    expect(
      (await page(search(app, 'Nami OP01-016', CARD_GAME_MAP.ONE_PIECE))).entries.map(card => card.variant_name),
    ).toEqual(['foil', 'altArt']);
  });

  integrationTest(
    'keeps continuation on its generation across refresh and retries price failures',
    async ({ createApp, db, user }) => {
      const feed = new CatalogTransport();
      feed.cards = Array.from({ length: 21 }, (_, index) => {
        const number = String(index + 30);

        return pokemonCard(VSTAR, number, number, 'Entei V', 'JA', undefined);
      });
      const client = createTestScrydexClient(feed.fetch, {});
      const catalog = new CardCatalog(new PostgresCardCatalog(db, client.source), client);
      const app = createApp({ config, pricingClient: client, cardCatalog: catalog });
      const search = searchAs(user.sessionToken);

      const first = await page(search(app, 'entei vstar', CARD_GAME_MAP.POKEMON));
      assert(first.next_cursor != null);
      const options = { cursor: first.next_cursor };
      expect(first.entries).toHaveLength(20);
      feed.cards = [pokemonCard(VSTAR, '29', '29', 'Entei V', 'JA', undefined), ...feed.cards];
      expect(await catalog.refresh(CARD_GAME_MAP.POKEMON, true)).toBe(CATALOG_BUILD_STATUS_MAP.READY);

      feed.failPrices = true;
      const unavailable = await search(app, 'entei vstar', CARD_GAME_MAP.POKEMON, options);
      expect(unavailable.status).toBe(503);
      expect(unavailable.headers.get('Retry-After')).not.toBeNull();

      feed.failPrices = false;
      const second = await page(search(app, 'entei vstar', CARD_GAME_MAP.POKEMON, options));
      expect(second.entries.map(card => card.card_number)).toEqual(['50']);
      expect(second.next_cursor).toBeNull();
      expect((await search(app, 'entei vs', CARD_GAME_MAP.POKEMON, options)).status).toBe(400);
      expect((await page(search(app, 'entei vstar', CARD_GAME_MAP.POKEMON))).entries[0]?.card_number).toBe('29');

      feed.failMetadata = true;
      expect(await catalog.refresh(CARD_GAME_MAP.POKEMON, true)).toBe(CATALOG_BUILD_STATUS_MAP.FAILED);
      expect((await page(search(app, 'entei vstar', CARD_GAME_MAP.POKEMON))).entries[0]?.card_number).toBe('29');
    },
  );

  integrationTest('a disconnected search leaves the shared build running', async ({ createApp, user }) => {
    const feed = new CatalogTransport();
    const requested = Promise.withResolvers<undefined>();
    const resume = Promise.withResolvers<undefined>();

    feed.pause = () => {
      requested.resolve(undefined);

      return resume.promise;
    };

    const app = createApp({ config, pricingClient: createTestScrydexClient(feed.fetch, {}) });
    const search = searchAs(user.sessionToken);
    const controller = new AbortController();
    const waiting = search(app, 'entei vs', CARD_GAME_MAP.POKEMON, { signal: controller.signal });
    await requested.promise;
    controller.abort();

    try {
      const unavailable = await waiting;

      expect(unavailable.status).toBe(503);
      expect(feed.priceRequests).toBe(0);
    } finally {
      resume.resolve(undefined);
    }

    expect((await page(search(app, 'entei vs', CARD_GAME_MAP.POKEMON))).entries).toHaveLength(4);
    expect(feed.metadataRequests).toBe(2);
  });

  integrationTest('returns a retryable error when the initial catalog build fails', async ({ createApp, user }) => {
    const feed = new CatalogTransport();
    feed.failMetadata = true;
    const app = createApp({ config, pricingClient: createTestScrydexClient(feed.fetch, {}) });
    const response = await searchAs(user.sessionToken)(app, 'entei vs', CARD_GAME_MAP.POKEMON);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'PRICING_CATALOG_UNAVAILABLE' });
    expect(response.headers.get('Retry-After')).not.toBeNull();
    expect(feed.priceRequests).toBe(0);
  });

  integrationTest(
    'publishes an initial catalog with an isolated card missing both numbers',
    async ({ createApp, user }) => {
      const feed = new CatalogTransport();
      const numberless = { ...UNRELATED, id: 'numberless-entei', number: null, printed_number: null };

      const fillers = Array.from({ length: 15 }, (_, index) => {
        return pokemonCard(VSTAR, String(index), String(index), 'Other card', 'JA', undefined);
      });

      feed.cards = [...fillers, numberless, ...ENTEI_CARDS];
      const app = createApp({ config, pricingClient: createTestScrydexClient(feed.fetch, {}) });

      const result = await page(searchAs(user.sessionToken)(app, 'entei vs', CARD_GAME_MAP.POKEMON));
      expect(result.entries.map(card => card.card_number)).toEqual(['91/95', '095/141', '019/172', '213/172']);
    },
  );

  integrationTest('rejects an initial catalog with too many unsearchable cards', async ({ createApp, user }) => {
    const feed = new CatalogTransport();
    feed.cards = [UNRELATED, { ...UNRELATED, id: 'numberless-entei', number: null, printed_number: null }];
    const app = createApp({ config, pricingClient: createTestScrydexClient(feed.fetch, {}) });

    const response = await searchAs(user.sessionToken)(app, 'entei', CARD_GAME_MAP.POKEMON);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'PRICING_CATALOG_UNAVAILABLE' });
    expect(feed.priceRequests).toBe(0);
  });
});

function pokemonCard(
  expansion: { id: string; name: string },
  number: string,
  printedNumber: string,
  name: string,
  language: string,
  translation: string | undefined,
): ScrydexRawCard {
  return {
    id: `${expansion.id}-${number}`,
    name,
    number,
    printed_number: printedNumber,
    expansion,
    language_code: language,
    translation: translation != null ? { en: { name: translation } } : undefined,
    variants: [{ name: 'normal' }],
  };
}

function searchAs(sessionToken: string) {
  return (
    app: { request(path: string, options: RequestInit): Response | Promise<Response> },
    query: string,
    game: CardGame,
    options?: { languages?: string; cursor?: string; signal?: AbortSignal },
  ) => {
    const params = new URLSearchParams({ game, query, search_by: PRICING_SEARCH_MODE_MAP.CARD });

    if (options?.languages != null) {
      params.set('languages', options.languages);
    }

    if (options?.cursor != null) {
      params.set('cursor', options.cursor);
    }

    return app.request(`${SEARCH_PRICING_ROUTE_PATH}?${params}`, {
      headers: sessionHeaders(sessionToken),
      signal: options?.signal,
    });
  };
}

async function page(pending: Response | Promise<Response>) {
  const response = await pending;
  const body: unknown = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));

  return PricingSearchResponseSchema.parse(body);
}

class CatalogTransport {
  readonly expansions = [VSTAR, VS, MAGMA, WILD_FORCE, SET_151];
  cards = [...ENTEI_CARDS, SHIFTRY, CHARIZARD, UNRELATED];
  pause: (() => Promise<void>) | undefined;
  metadataRequests = 0;
  priceRequests = 0;
  failMetadata = false;
  failPrices = false;

  readonly fetch: typeof fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const onePiece = url.pathname.startsWith('/onepiece/');
    const cards = onePiece ? [NAMI] : this.cards;

    if (url.searchParams.has('include')) {
      assert.equal(url.searchParams.get('include'), onePiece ? 'prices' : 'prices,pop_reports');
      this.priceRequests += 1;

      if (this.failPrices) {
        return new Response(null, { status: 503 });
      }

      const query = url.searchParams.get('q') ?? '';
      const ids = [...query.matchAll(/!id:([\w-]+)(?: OR |$)/g)].map(match => match[1]);
      const data = cards.filter(card => ids.includes(String(card.id)));

      return Response.json({ data, totalCount: data.length });
    }

    this.metadataRequests += 1;
    await this.pause?.();

    if (this.failMetadata) {
      return new Response(null, { status: 503 });
    }

    const expansions = onePiece ? [ROMANCE, HEROINES] : this.expansions;
    const data = url.pathname.endsWith('/expansions') ? expansions : cards;

    return Response.json({ data, totalCount: data.length });
  };
}

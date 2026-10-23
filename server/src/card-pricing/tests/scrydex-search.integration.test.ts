import type { ScrydexRawCard } from '@tcg/scrydex';

import { sessionHeaders } from '../../cards/tests/utils.ts';
import type { Database } from '../../db/index.ts';
import { cardPriceSearch } from '../../db/schema/card-pricing.ts';
import App from '../../runtime/node/app.ts';
import type { ObjectStorageClient } from '../../storage/client.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { parseCardLanguages } from '../languages.ts';
import { SEARCH_PRICING_ROUTE_PATH } from '../routes/search-pricing.ts';
import { PricingSearchResponseSchema } from '../schemas/responses.ts';
import { RealScrydexClient } from '../scrydex/real-client.ts';
import type { CardGame } from '../types.ts';
import { queryKey, todayUTC } from '../utils/query.ts';

const SHIFTRY = {
  id: 'sv5m_ja-72',
  name: 'ダーテング',
  number: '72',
  printed_number: '072/071',
  language_code: 'JA',
  expansion: { id: 'sv5m_ja', code: 'SV5M', name: '  Wild Force  ' },
  translation: { en: { name: 'Shiftry' } },
  variants: [{ name: 'holofoil', prices: [{ condition: 'NM', type: 'raw', currency: 'JPY', low: 800 }] }],
} satisfies ScrydexRawCard;

const SET_AND_PRINTED_NUMBER = '(!expansion.id:sv5m OR !expansion.id:sv5m_ja) AND !printed_number:"072/071"';

const LUFFY_PROMO = {
  id: 'P-110',
  name: 'Monkey.D.Luffy',
  number: '110',
  printed_number: 'P-110',
  variants: [
    { name: 'fourthAnniversaryStamp', prices: [{ condition: 'NM', type: 'raw', currency: 'USD', market: 20 }] },
    { name: 'fourthAnniversaryWinnerStamp' },
  ],
} satisfies ScrydexRawCard;

const TORCHIC_PROMO = {
  id: 'mep-56',
  name: 'Torchic',
  number: '56',
  printed_number: '056',
  language_code: 'EN',
  expansion: { id: 'mep', code: 'MEP', name: 'Mega Evolution Black Star Promos' },
} satisfies ScrydexRawCard;

const MEP_AND_NUMBER = '(!expansion.id:mep OR !expansion.id:mep_ja) AND !number:56';

describe('Scrydex search through the authenticated pricing API', () => {
  for (const { query, expectedQuery } of [
    { query: 'p-110', expectedQuery: '!id:P-110' },
    { query: 'Monkey.D.Luffy P-110', expectedQuery: 'name:"Monkey.D.Luffy" AND !id:P-110' },
  ]) {
    integrationTest(
      `finds the anniversary promo using ${query} without requiring base-variant pricing`,
      async ({ db, storageClient }) => {
        const search = await createSearchApp({
          db,
          storageClient,
          game: 'one_piece',
          expectedQuery,
          cards: [LUFFY_PROMO],
        });

        const response = await search.request(query);

        expect(response.status).toBe(200);

        const body = PricingSearchResponseSchema.parse(await response.json());
        expect(body.matches).toMatchObject([{ game: 'one_piece', name: 'Monkey.D.Luffy', card_number: 'P-110' }]);
        expect(body.matches[0]).not.toHaveProperty('market');
        expect(body.matches[0]).not.toHaveProperty('headline');
        expect(search.transport.paths).toEqual(['/onepiece/v1/cards']);
        expect(search.transport.queries).toEqual([expectedQuery]);
      },
    );
  }

  integrationTest(
    'bypasses the old empty promo cache and reuses the corrected result',
    async ({ db, storageClient }) => {
      await db.insert(cardPriceSearch).values({
        game: 'one_piece',
        pricingSource: 'scrydex_real',
        queryKey: 'one_piece|p-110',
        pricedOn: todayUTC(),
        pricingCardIds: [],
      });

      const search = await createSearchApp({
        db,
        storageClient,
        game: 'one_piece',
        expectedQuery: '!id:P-110',
        cards: [LUFFY_PROMO],
      });

      const first = await search.request('p-110');

      expect(first.status).toBe(200);

      const body = PricingSearchResponseSchema.parse(await first.json());
      expect(body.matches).toMatchObject([{ name: 'Monkey.D.Luffy', card_number: 'P-110' }]);
      expect(await db.query.cardPrice.findFirst({ where: { pricingCardId: 'P-110' } })).toMatchObject({
        pricingSource: 'scrydex_real',
        cardNumber: 'P-110',
      });
      expect(await db.query.cardPriceSearch.findFirst({ where: { queryKey: 'one_piece|v2|p-110' } })).toMatchObject({
        pricingCardIds: ['P-110'],
      });

      const second = await search.request(' P-110 ', 'en');

      expect(second.status).toBe(200);
      expect(PricingSearchResponseSchema.parse(await second.json())).toEqual(body);
      expect(search.transport.queries).toEqual(['!id:P-110']);
      expect(await db.query.cardPriceSearch.findMany()).toHaveLength(2);
    },
  );

  integrationTest('keeps an empty provider promo search empty', async ({ db, storageClient }) => {
    const search = await createSearchApp({
      db,
      storageClient,
      game: 'one_piece',
      expectedQuery: '!id:P-110',
      cards: [],
    });

    const response = await search.request('p-110');

    expect(response.status).toBe(200);
    expect(PricingSearchResponseSchema.parse(await response.json())).toEqual({ matches: [] });
    expect(search.transport.queries).toEqual(['!id:P-110']);
    expect(await db.query.cardPrice.findMany()).toEqual([]);
  });

  for (const { languages, oldKey, expectedQuery } of [
    { languages: '', oldKey: 'pokemon|v2|mep 056', expectedQuery: MEP_AND_NUMBER },
    {
      languages: 'en',
      oldKey: 'pokemon|languages-v1|en|mep 056',
      expectedQuery: `(${MEP_AND_NUMBER}) AND (!language_code:EN)`,
    },
  ]) {
    integrationTest(
      `finds Torchic by MEP promo code despite an old empty cache with languages=${languages}`,
      async ({ db, storageClient }) => {
        await db.insert(cardPriceSearch).values({
          game: 'pokemon',
          pricingSource: 'scrydex_real',
          queryKey: oldKey,
          pricedOn: todayUTC(),
          pricingCardIds: [],
        });
        const search = await createSearchApp({ db, storageClient, expectedQuery, cards: [TORCHIC_PROMO] });
        const first = await search.request('mep 056', languages);

        expect(first.status).toBe(200);

        const body = PricingSearchResponseSchema.parse(await first.json());
        expect(body.matches).toMatchObject([
          { game: 'pokemon', name: 'Torchic', card_number: '056', set_name: 'Mega Evolution Black Star Promos' },
        ]);
        expect(await db.query.cardPrice.findFirst({ where: { pricingCardId: 'mep-56' } })).toMatchObject({
          name: 'Torchic',
          cardNumber: '056',
        });
        expect(
          await db.query.cardPriceSearch.findFirst({
            where: { queryKey: queryKey('pokemon', 'mep 056', parseCardLanguages(languages)) },
          }),
        ).toMatchObject({ pricingCardIds: ['mep-56'] });

        const second = await search.request(' MEP   056 ', languages);

        expect(second.status).toBe(200);
        expect(PricingSearchResponseSchema.parse(await second.json())).toEqual(body);
        expect(search.transport.paths).toEqual(['/pokemon/v1/cards']);
        expect(search.transport.queries).toEqual([expectedQuery]);
      },
    );
  }

  integrationTest('applies the English filter before requesting provider results', async ({ db, storageClient }) => {
    const card = { id: 'sv5-163', name: 'Shiftry', number: '163', language_code: 'EN' };
    const expectedQuery = '(name:"Shiftry") AND (!language_code:EN)';
    const search = await createSearchApp({ db, storageClient, expectedQuery, cards: [card] });

    const response = await search.request('Shiftry', 'en');

    expect(response.status).toBe(200);
    expect(PricingSearchResponseSchema.parse(await response.json()).matches).toHaveLength(1);
    expect(search.transport.queries).toEqual([expectedQuery]);
    expect(
      await db.query.cardPriceSearch.findFirst({ where: { queryKey: queryKey('pokemon', 'Shiftry', ['en']) } }),
    ).toMatchObject({ pricingCardIds: [card.id] });
  });

  integrationTest('applies the Japanese filter before requesting provider results', async ({ db, storageClient }) => {
    const card = SHIFTRY;
    const expectedQuery = '(name:"Shiftry") AND (!language_code:JA)';
    const search = await createSearchApp({ db, storageClient, expectedQuery, cards: [card] });

    const response = await search.request('Shiftry', 'ja');

    expect(response.status).toBe(200);
    expect(PricingSearchResponseSchema.parse(await response.json()).matches).toHaveLength(1);
    expect(search.transport.queries).toEqual([expectedQuery]);
    expect(
      await db.query.cardPriceSearch.findFirst({ where: { queryKey: queryKey('pokemon', 'Shiftry', ['ja']) } }),
    ).toMatchObject({ pricingCardIds: [card.id] });
  });

  integrationTest(
    'finds Japanese Shiftry by set code and printed number and persists its identity',
    async ({ db, storageClient }) => {
      const search = await createSearchApp({
        db,
        storageClient,
        expectedQuery: SET_AND_PRINTED_NUMBER,
        cards: [SHIFTRY],
      });

      const response = await search.request('sv5m 072/071');

      expect(response.status).toBe(200);
      expect(PricingSearchResponseSchema.parse(await response.json()).matches).toMatchObject([
        {
          game: 'pokemon',
          name: 'ダーテング',
          set_name: 'Wild Force',
          card_number: '072/071',
          headline: { amount: 800, currency: 'JPY' },
        },
      ]);
      expect(search.transport.queries).toEqual([SET_AND_PRINTED_NUMBER]);
      expect(search.transport.paths).toEqual(['/pokemon/v1/cards']);
      expect(await db.query.cardPrice.findFirst({ where: { pricingCardId: 'sv5m_ja-72' } })).toMatchObject({
        pricingSource: 'scrydex_real',
        name: 'ダーテング',
        cardNumber: '072/071',
        prices: { setName: 'Wild Force' },
        raw: { ...SHIFTRY, expansion: { ...SHIFTRY.expansion, name: 'Wild Force' } },
      });
      expect(
        await db.query.cardPriceSearch.findFirst({ where: { queryKey: queryKey('pokemon', 'sv5m 072/071') } }),
      ).toMatchObject({
        pricingSource: 'scrydex_real',
        pricingCardIds: ['sv5m_ja-72'],
      });
    },
  );

  integrationTest(
    'finds a Japanese card by explicit expansion ID and unpadded number',
    async ({ db, storageClient }) => {
      const search = await createSearchApp({
        db,
        storageClient,
        expectedQuery: '!expansion.id:sv5m_ja AND !number:72',
        cards: [SHIFTRY],
      });

      const response = await search.request('  SV5M_JA   072  ');

      expect(response.status).toBe(200);
      expect(PricingSearchResponseSchema.parse(await response.json()).matches).toMatchObject([
        { name: 'ダーテング', card_number: '072/071' },
      ]);
      expect(search.transport.queries).toEqual(['!expansion.id:sv5m_ja AND !number:72']);
    },
  );

  integrationTest(
    'matches Japanese cards through their English translated name using the provider name index',
    async ({ db, storageClient }) => {
      const search = await createSearchApp({
        db,
        storageClient,
        expectedQuery: 'name:"Shiftry" AND !printed_number:"072/071"',
        cards: [SHIFTRY],
      });

      const response = await search.request('Shiftry 072/071');

      expect(response.status).toBe(200);
      expect(PricingSearchResponseSchema.parse(await response.json()).matches).toMatchObject([
        { name: 'ダーテング', card_number: '072/071' },
      ]);
      expect(search.transport.queries).toEqual(['name:"Shiftry" AND !printed_number:"072/071"']);
      expect(search.transport.paths).toEqual(['/pokemon/v1/cards']);
    },
  );

  integrationTest(
    'matches native names when the provider has no English translation or market price',
    async ({ db, storageClient }) => {
      const nativeCard = { id: 'sv5m_ja-72', name: 'ダーテング', number: '72', printed_number: '072/071' };

      const search = await createSearchApp({
        db,
        storageClient,
        expectedQuery: 'name:"ダーテング"',
        cards: [nativeCard],
      });

      const response = await search.request('ダーテング');

      expect(response.status).toBe(200);
      const body = PricingSearchResponseSchema.parse(await response.json());
      expect(body.matches).toMatchObject([{ name: 'ダーテング', card_number: '072/071' }]);
      expect(body.matches[0]).not.toHaveProperty('headline');
      expect(search.transport.queries).toEqual(['name:"ダーテング"']);
    },
  );

  integrationTest(
    'returns English and Japanese cards together for a name-only search',
    async ({ db, storageClient }) => {
      const englishCard = {
        id: 'sv5-163',
        name: 'Shiftry',
        number: '163',
        printed_number: '163/162',
        language_code: 'EN',
      };

      const search = await createSearchApp({
        db,
        storageClient,
        expectedQuery: 'name:"Shiftry"',
        cards: [englishCard, SHIFTRY],
      });

      const response = await search.request('Shiftry');

      expect(response.status).toBe(200);
      expect(PricingSearchResponseSchema.parse(await response.json()).matches).toMatchObject([
        { name: 'Shiftry', card_number: '163/162' },
        { name: 'ダーテング', card_number: '072/071' },
      ]);
      expect(search.transport.paths).toEqual(['/pokemon/v1/cards']);
      expect(search.transport.queries).toEqual(['name:"Shiftry"']);
      expect(await db.query.cardPrice.findMany()).toHaveLength(2);
    },
  );

  integrationTest('returns no matches when the printed denominator differs', async ({ db, storageClient }) => {
    const search = await createSearchApp({
      db,
      storageClient,
      expectedQuery: SET_AND_PRINTED_NUMBER,
      cards: [SHIFTRY],
    });

    const response = await search.request('sv5m 072/070');

    expect(response.status).toBe(200);
    expect(PricingSearchResponseSchema.parse(await response.json())).toEqual({ matches: [] });
    expect(search.transport.queries).toEqual([
      '(!expansion.id:sv5m OR !expansion.id:sv5m_ja) AND !printed_number:"072/070"',
    ]);
    expect(await db.query.cardPrice.findMany()).toEqual([]);
  });

  integrationTest('reuses persisted search results without another provider request', async ({ db, storageClient }) => {
    const search = await createSearchApp({
      db,
      storageClient,
      expectedQuery: SET_AND_PRINTED_NUMBER,
      cards: [SHIFTRY],
    });

    const first = await search.request('sv5m 072/071');
    expect(first.status).toBe(200);
    const firstBody = PricingSearchResponseSchema.parse(await first.json());
    expect(firstBody.matches[0]).toHaveProperty('set_name', 'Wild Force');

    const second = await search.request(' SV5M   072/071 ');

    expect(second.status).toBe(200);
    expect(PricingSearchResponseSchema.parse(await second.json())).toEqual(firstBody);
    expect(search.transport.queries).toEqual([SET_AND_PRINTED_NUMBER]);
    expect(await db.query.cardPriceSearch.findMany()).toHaveLength(1);
  });

  integrationTest(
    'ignores empty search results cached under the previous query version',
    async ({ db, storageClient }) => {
      await db.insert(cardPriceSearch).values({
        game: 'pokemon',
        pricingSource: 'scrydex_real',
        queryKey: 'pokemon|sv5m 072/071',
        pricedOn: todayUTC(),
        pricingCardIds: [],
      });

      const search = await createSearchApp({
        db,
        storageClient,
        expectedQuery: SET_AND_PRINTED_NUMBER,
        cards: [SHIFTRY],
      });

      const response = await search.request('sv5m 072/071');

      expect(response.status).toBe(200);
      expect(PricingSearchResponseSchema.parse(await response.json()).matches).toHaveLength(1);
      expect(search.transport.queries).toEqual([SET_AND_PRINTED_NUMBER]);
      expect(await db.query.cardPriceSearch.findMany()).toHaveLength(2);
    },
  );
});

interface SearchAppOptions {
  game?: CardGame;
  db: Database;
  storageClient: ObjectStorageClient;
  expectedQuery: string;
  cards: ScrydexRawCard[];
}

async function createSearchApp({ db, storageClient, expectedQuery, cards, game = 'pokemon' }: SearchAppOptions) {
  const transport = new ScrydexSearchTransport(expectedQuery, cards, game);

  const pricingClient = new RealScrydexClient({
    apiKey: 'test-api-key',
    teamId: 'test-team-id',
    baseURL: 'https://scrydex.test',
    fetch: transport.fetch,
  });

  const { app } = new App({ db, storageClient, pricingClient });
  const user = await createTestUser(app, db);

  return {
    transport,
    request: (query: string, languages = '') =>
      app.request(`${SEARCH_PRICING_ROUTE_PATH}?${new URLSearchParams({ game, query, languages })}`, {
        headers: sessionHeaders(user.sessionToken),
      }),
  };
}

class ScrydexSearchTransport {
  readonly queries: string[] = [];
  readonly paths: string[] = [];

  constructor(
    private readonly expectedQuery: string,
    private readonly cards: ScrydexRawCard[],
    private readonly game: CardGame,
  ) {}

  readonly fetch: typeof fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const query = url.searchParams.get('q') ?? '';
    this.queries.push(query);
    this.paths.push(url.pathname);
    const expectedPath = this.game === 'pokemon' ? '/pokemon/v1/cards' : '/onepiece/v1/cards';
    const data = url.pathname === expectedPath && query === this.expectedQuery ? this.cards : [];

    return Response.json({ data, total_count: data.length });
  };
}

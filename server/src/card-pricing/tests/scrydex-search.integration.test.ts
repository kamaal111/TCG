import App from '../../app.ts';
import { sessionHeaders } from '../../cards/tests/utils.ts';
import type { Database } from '../../db/index.ts';
import { cardPriceSearch } from '../../db/schema/card-pricing.ts';
import type { ObjectStorageClient } from '../../storage/client.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { SEARCH_PRICING_ROUTE_PATH } from '../handlers/search-pricing.ts';
import { PricingSearchResponseSchema } from '../schemas/responses.ts';
import { RealScrydexClient } from '../scrydex/real-client.ts';
import type { ScrydexRawCard } from '../scrydex/types.ts';
import { queryKey, todayUTC } from '../utils/query.ts';

const SHIFTRY = {
  id: 'sv5m_ja-72',
  name: 'ダーテング',
  number: '72',
  printed_number: '072/071',
  language_code: 'JA',
  expansion: { id: 'sv5m_ja', code: 'SV5M' },
  translation: { en: { name: 'Shiftry' } },
  variants: [{ name: 'holofoil', prices: [{ condition: 'NM', type: 'raw', currency: 'JPY', low: 800 }] }],
} satisfies ScrydexRawCard;

const SET_AND_PRINTED_NUMBER = '(!expansion.id:sv5m OR !expansion.id:sv5m_ja) AND !printed_number:"072/071"';

describe('Scrydex search through the authenticated pricing API', () => {
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
        { game: 'pokemon', name: 'ダーテング', card_number: '072/071', headline: { amount: 800, currency: 'JPY' } },
      ]);
      expect(search.transport.queries).toEqual([SET_AND_PRINTED_NUMBER]);
      expect(search.transport.paths).toEqual(['/pokemon/v1/cards']);
      expect(await db.query.cardPrice.findFirst({ where: { pricingCardId: 'sv5m_ja-72' } })).toMatchObject({
        pricingSource: 'scrydex_real',
        name: 'ダーテング',
        cardNumber: '072/071',
        raw: SHIFTRY,
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
  db: Database;
  storageClient: ObjectStorageClient;
  expectedQuery: string;
  cards: ScrydexRawCard[];
}

async function createSearchApp({ db, storageClient, expectedQuery, cards }: SearchAppOptions) {
  const transport = new ScrydexSearchTransport(expectedQuery, cards);

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
    request: (query: string) =>
      app.request(`${SEARCH_PRICING_ROUTE_PATH}?${new URLSearchParams({ game: 'pokemon', query })}`, {
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
  ) {}

  readonly fetch: typeof fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const query = url.searchParams.get('q') ?? '';
    this.queries.push(query);
    this.paths.push(url.pathname);
    const data = url.pathname === '/pokemon/v1/cards' && query === this.expectedQuery ? this.cards : [];

    return Response.json({ data, total_count: data.length });
  };
}

import assert from 'node:assert/strict';

import type { ScrydexRawCard } from '@tcg/scrydex';

import { createTestScrydexClient } from './utils.ts';
import { proxyURLForOriginURL } from '../../card-images/keys.ts';
import { LIST_CARDS_ROUTE_PATH } from '../../cards/routes/list-cards.ts';
import { CardsListResponseSchema, CardWithPriceSchema } from '../../cards/schemas/responses.ts';
import { createCardRequest, createTestCard } from '../../cards/tests/utils.ts';
import { cardPriceSearch } from '../../db/schema/card-pricing.ts';
import { card } from '../../db/schema/cards.ts';
import type App from '../../runtime/node/app.ts';
import { expectValidationIssueForField, sessionHeaders } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import type { createTestUser } from '../../tests/utils.ts';
import { parseCardLanguages } from '../languages.ts';
import { SEARCH_PRICING_ROUTE_PATH } from '../routes/search-pricing.ts';
import { PricedCardSchema, PricingSearchResponseSchema } from '../schemas/responses.ts';
import type { CardGame } from '../types.ts';
import { searchPageKey } from '../utils/pagination.ts';
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

const CHI_YU_IMAGE = 'https://images.example.com/chi-yu.png';

const CHI_YU = {
  id: 'sv2-259',
  name: 'Chi-Yu ex',
  number: '259',
  printed_number: '259/193',
  artist: 'Akira Egawa',
  expansion: { name: 'Paldea Evolved' },
  images: [{ type: 'front', large: CHI_YU_IMAGE }],
} satisfies ScrydexRawCard;

const CHI_YU_PAYLOAD = {
  game: 'pokemon',
  name: CHI_YU.name,
  set_name: CHI_YU.expansion.name,
  card_number: CHI_YU.printed_number,
  purchases: [{ condition: 'near_mint', quantity: 1, purchase_price: null, currency: null }],
} satisfies Parameters<typeof createCardRequest>[2];

const PRINTED_NUMBER_CASES = [
  {
    providerCard: {
      id: 'swsh12pt5gg-GG69',
      name: 'Giratina VSTAR',
      number: 'GG69',
      printed_number: 'GG69/GG70',
      expansion: { name: 'Crown Zenith Galarian Gallery' },
      images: [{ type: 'front', large: 'https://images.example.com/giratina.png' }],
      variants: [{ name: 'normal', prices: [{ condition: 'NM', type: 'raw', currency: 'USD', low: 146.69 }] }],
    },
    status: 'priced',
  },
  {
    providerCard: {
      id: 'swsh11tg-TG05',
      name: 'Pikachu',
      number: 'TG05',
      printed_number: 'TG05/TG30',
      expansion: { name: 'Lost Origin Trainer Gallery' },
      images: [{ type: 'front', large: 'https://images.example.com/pikachu.png' }],
      variants: [],
    },
    status: 'no_price',
  },
  {
    providerCard: {
      ...SHIFTRY,
      expansion: { name: 'Wild Force' },
      images: [{ type: 'front', large: 'https://images.example.com/shiftry.png' }],
    },
    status: 'priced',
  },
] as const satisfies { providerCard: ScrydexRawCard; status: string }[];

describe('Scrydex search through the authenticated pricing API', () => {
  integrationTest(
    'follows Scrydex search pages and caches each continuation independently',
    async ({ createApp, user, db }) => {
      const cards = Array.from({ length: 135 }, (_, index) => ({
        id: `pikachu-${index + 1}`,
        name: 'Pikachu',
        number: String(index + 1),
      }));

      await db.insert(cardPriceSearch).values({
        game: 'pokemon',
        pricingSource: 'scrydex_real',
        queryKey: queryKey('pokemon', 'Pikachu', { languages: [], searchBy: 'card' }),
        pricedOn: todayUTC(),
        pricingCardIds: cards.slice(0, 20).map(card => card.id),
      });

      const transport = vi.fn<typeof fetch>().mockImplementation(async input => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        const size = Number(url.searchParams.get('page_size'));
        const start = (Number(url.searchParams.get('page')) - 1) * size;

        return Response.json({ data: cards.slice(start, start + size), total_count: cards.length });
      });

      const app = createApp({ pricingClient: createTestScrydexClient(transport) });
      const headers = sessionHeaders(user.sessionToken);
      const url = `${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Pikachu&search_by=card`;

      const first = await app.request(url, { headers });
      expect(first.status).toBe(200);
      const page = PricingSearchResponseSchema.parse(await first.json());
      expect(page.matches.map(card => card.card_number)).toEqual(cards.slice(0, 100).map(card => card.number));
      expect(page.next_cursor).toEqual(expect.any(String));

      const nextURL = `${url}&cursor=${page.next_cursor}`;
      const second = await app.request(nextURL, { headers });
      expect(second.status).toBe(200);
      const last = PricingSearchResponseSchema.parse(await second.json());
      expect(last.matches.map(card => card.card_number)).toEqual(cards.slice(100).map(card => card.number));
      expect(last.next_cursor).toBeNull();

      const repeatedFirst = await app.request(url, { headers });
      const repeatedSecond = await app.request(nextURL, { headers });
      expect(await repeatedFirst.json()).toEqual(page);
      expect(await repeatedSecond.json()).toEqual(last);

      const requestedURLs = transport.mock.calls.map(
        ([input]) => new URL(input instanceof Request ? input.url : input.toString()),
      );

      expect(requestedURLs.map(url => url.searchParams.get('page'))).toEqual(['1', '2']);

      await expectValidationIssueForField(await app.request(`${url}&cursor=invalid!`, { headers }), 'cursor');
      await expectValidationIssueForField(await app.request(`${nextURL}&languages=ja`, { headers }), 'cursor');
      expect(transport).toHaveBeenCalledTimes(2);
    },
  );

  integrationTest(
    'saves the selected artwork when the same name and number are ambiguous',
    async ({ createApp, user, db }) => {
      const alternate = {
        ...CHI_YU,
        id: 'sv2-alt-259',
        images: [{ type: 'front', large: 'https://images.example.com/other-chi-yu.png' }],
      };

      const search = createSearchApp({
        createApp,
        user,
        expectedQuery: '!printed_number:"259/193"',
        cards: [alternate, CHI_YU],
      });

      const results = PricingSearchResponseSchema.parse(await (await search.request('259/193')).json());
      const expectedImage = proxyURLForOriginURL(CHI_YU_IMAGE, 'http://localhost:8080');
      const selected = results.matches.find(match => match.image_url === expectedImage);
      assert(selected != null);

      const saved = await createTestCard(search.app, user.sessionToken, {
        ...CHI_YU_PAYLOAD,
        priced_card_id: selected.id,
      });

      expect(saved.price).toMatchObject({ status: 'no_price', priced_card: { image_url: expectedImage } });
      expect(await db.query.card.findFirst({ where: { id: saved.id } })).toMatchObject({
        pricingCardId: CHI_YU.id,
        pricingSource: 'scrydex_real',
      });

      const headers = sessionHeaders(user.sessionToken);
      const list = await search.app.request(LIST_CARDS_ROUTE_PATH, { headers });
      expect(CardsListResponseSchema.parse(await list.json()).cards).toMatchObject([
        { id: saved.id, price: saved.price },
      ]);
      expect(search.transport.queries).toEqual(['!printed_number:"259/193"']);

      const replacement = results.matches.find(match => match.id !== selected.id);
      assert(replacement != null);

      const update = await search.app.request(`${LIST_CARDS_ROUTE_PATH}/${saved.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ...CHI_YU_PAYLOAD, priced_card_id: replacement.id }),
      });

      expect(update.status).toBe(200);
      expect(CardWithPriceSchema.parse(await update.json()).price.priced_card?.image_url).toBe(replacement.image_url);
      expect(await db.query.card.findFirst({ where: { id: saved.id } })).toMatchObject({
        pricingCardId: alternate.id,
      });

      const wrongPrinting = await createTestCard(search.app, user.sessionToken, {
        ...CHI_YU_PAYLOAD,
        set_name: 'Other Set',
        priced_card_id: selected.id,
      });

      expect(wrongPrinting.price.status).toBe('no_match');
      expect(await db.query.card.findFirst({ where: { id: wrongPrinting.id } })).toMatchObject({ pricingCardId: null });

      const ambiguous = await createTestCard(search.app, user.sessionToken, {
        ...CHI_YU_PAYLOAD,
        priced_card_id: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(ambiguous.price.status).toBe('no_match');
      expect(await db.query.card.findFirst({ where: { id: ambiguous.id } })).toMatchObject({ pricingCardId: null });
    },
  );

  integrationTest('recovers an existing unlinked card after a number-only search', async ({ createApp, user, db }) => {
    const search = createSearchApp({ createApp, user, expectedQuery: '!printed_number:"259/193"', cards: [CHI_YU] });
    const saved = await createTestCard(search.app, user.sessionToken, CHI_YU_PAYLOAD);
    expect(saved.price.status).toBe('no_match');

    const results = PricingSearchResponseSchema.parse(await (await search.request('259/193')).json());
    expect(results.matches).toHaveLength(1);
    const list = await search.app.request(LIST_CARDS_ROUTE_PATH, { headers: sessionHeaders(user.sessionToken) });
    expect(CardsListResponseSchema.parse(await list.json()).cards).toMatchObject([
      { id: saved.id, price: { status: 'no_price', priced_card: { image_url: results.matches[0]?.image_url } } },
    ]);
    expect(await db.query.card.findFirst({ where: { id: saved.id } })).toMatchObject({ pricingCardId: CHI_YU.id });
    expect(search.transport.queries).toEqual([
      'name:"Chi\\-Yu ex" AND !printed_number:"259/193"',
      '!printed_number:"259/193"',
    ]);
  });

  for (const { providerCard, status } of PRINTED_NUMBER_CASES) {
    integrationTest(
      `preserves artwork when saving and listing ${providerCard.printed_number} with ${status} pricing`,
      async ({ createApp, user, db }) => {
        const expectedQuery = `name:"${providerCard.name}" AND !printed_number:"${providerCard.printed_number}"`;
        const nameQuery = `name:"${providerCard.name}"`;

        const search = createSearchApp({
          createApp,
          user,
          expectedQuery: [nameQuery, expectedQuery],
          cards: [providerCard],
        });

        const first = await search.request(providerCard.name);

        expect(first.status).toBe(200);
        const searched = PricingSearchResponseSchema.parse(await first.json());
        expect(searched.matches).toHaveLength(1);
        const match = PricedCardSchema.parse(searched.matches[0]);

        const created = await createCardRequest(search.app, search.user.sessionToken, {
          game: 'pokemon',
          name: match.name,
          set_name: providerCard.expansion.name,
          card_number: match.card_number,
          purchases: [{ condition: 'near_mint', quantity: 1, purchase_price: null, currency: null }],
        });

        expect(created.status).toBe(201);
        const saved = CardWithPriceSchema.parse(await created.json());
        const expectedImage = proxyURLForOriginURL(providerCard.images[0].large, 'http://localhost:8080');
        expect(match).toMatchObject({ card_number: providerCard.printed_number, image_url: expectedImage });
        expect(saved.price).toMatchObject({
          status,
          priced_card: { id: match.id, card_number: providerCard.printed_number, image_url: expectedImage },
        });
        expect(await db.query.card.findFirst({ where: { id: saved.id } })).toMatchObject({
          pricingCardId: providerCard.id,
          pricingSource: 'scrydex_real',
        });

        const listed = await search.app.request(LIST_CARDS_ROUTE_PATH, {
          headers: sessionHeaders(search.user.sessionToken),
        });

        expect(listed.status).toBe(200);
        const collection = CardsListResponseSchema.parse(await listed.json());
        expect(collection.cards).toHaveLength(1);
        expect(collection.cards[0]).toMatchObject({ id: saved.id, price: saved.price });

        const repeated = await search.app.request(LIST_CARDS_ROUTE_PATH, {
          headers: sessionHeaders(search.user.sessionToken),
        });

        expect(repeated.status).toBe(200);
        expect(CardsListResponseSchema.parse(await repeated.json())).toEqual(collection);
        expect(search.transport.queries).toEqual([nameQuery]);
      },
    );

    integrationTest(
      `recovers an unlinked ${providerCard.printed_number} collection entry despite a v3 empty cache`,
      async ({ createApp, user, db }) => {
        const expectedQuery = `name:"${providerCard.name}" AND !printed_number:"${providerCard.printed_number}"`;
        const search = createSearchApp({ createApp, user, expectedQuery, cards: [providerCard] });
        await db.insert(card).values({
          userId: search.user.userId,
          game: 'pokemon',
          name: providerCard.name,
          setName: providerCard.expansion.name,
          cardNumber: providerCard.printed_number,
        });
        await db.insert(cardPriceSearch).values({
          game: 'pokemon',
          pricingSource: 'scrydex_real',
          queryKey: `pokemon|v3|${providerCard.name.toLowerCase()} ${providerCard.printed_number.toLowerCase()}`,
          pricedOn: todayUTC(),
          pricingCardIds: [],
        });

        const response = await search.app.request(LIST_CARDS_ROUTE_PATH, {
          headers: sessionHeaders(search.user.sessionToken),
        });

        expect(response.status).toBe(200);
        expect(CardsListResponseSchema.parse(await response.json()).cards).toMatchObject([
          {
            card_number: providerCard.printed_number,
            price: {
              status,
              priced_card: {
                image_url: proxyURLForOriginURL(providerCard.images[0].large, 'http://localhost:8080'),
              },
            },
          },
        ]);
        expect(await db.query.card.findFirst({ where: { userId: search.user.userId } })).toMatchObject({
          pricingCardId: providerCard.id,
          pricingSource: 'scrydex_real',
        });
        expect(search.transport.queries).toEqual([expectedQuery]);
      },
    );
  }

  for (const { languages, oldKey, expectedQuery } of [
    { languages: '', oldKey: 'pokemon|v3|gg69/gg70', expectedQuery: '!printed_number:"GG69/GG70"' },
    {
      languages: 'en',
      oldKey: 'pokemon|v3|languages-v1|en|gg69/gg70',
      expectedQuery: '(!printed_number:"GG69/GG70") AND (!language_code:EN)',
    },
  ]) {
    integrationTest(
      `finds lowercase prefixed printed numbers despite a v3 empty cache with languages=${languages}`,
      async ({ createApp, user, db }) => {
        await db.insert(cardPriceSearch).values({
          game: 'pokemon',
          pricingSource: 'scrydex_real',
          queryKey: oldKey,
          pricedOn: todayUTC(),
          pricingCardIds: [],
        });

        const search = createSearchApp({
          createApp,
          user,
          expectedQuery,
          cards: [PRINTED_NUMBER_CASES[0].providerCard],
        });

        const response = await search.request('gg69/gg70', languages);
        expect(response.status).toBe(200);
        expect(PricingSearchResponseSchema.parse(await response.json()).matches).toMatchObject([
          { name: 'Giratina VSTAR', card_number: 'GG69/GG70', image_url: expect.any(String) },
        ]);
        expect(search.transport.queries).toEqual([expectedQuery]);
      },
    );
  }

  integrationTest('keeps prefixed printed denominators exact', async ({ createApp, user }) => {
    const search = createSearchApp({
      createApp,
      user,
      expectedQuery: '!printed_number:"GG69/GG70"',
      cards: [PRINTED_NUMBER_CASES[0].providerCard],
    });

    const response = await search.request('GG69/GG71');
    expect(response.status).toBe(200);
    expect(PricingSearchResponseSchema.parse(await response.json())).toEqual({ matches: [], next_cursor: null });
    expect(search.transport.queries).toEqual(['!printed_number:"GG69/GG71"']);
  });

  for (const { query, expectedQuery } of [
    { query: 'p-110', expectedQuery: '!id:P-110' },
    { query: 'Monkey.D.Luffy P-110', expectedQuery: 'name:"Monkey.D.Luffy" AND !id:P-110' },
  ]) {
    integrationTest(
      `finds the anniversary promo using ${query} without requiring base-variant pricing`,
      async ({ createApp, user }) => {
        const search = createSearchApp({
          createApp,
          user,
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
    async ({ createApp, user, db }) => {
      await db.insert(cardPriceSearch).values({
        game: 'one_piece',
        pricingSource: 'scrydex_real',
        queryKey: 'one_piece|p-110',
        pricedOn: todayUTC(),
        pricingCardIds: [],
      });

      const search = createSearchApp({
        createApp,
        user,
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
      expect(
        await db.query.cardPriceSearch.findFirst({ where: { queryKey: searchPageKey('one_piece|v2|p-110', 0) } }),
      ).toMatchObject({
        pricingCardIds: ['P-110'],
      });

      const second = await search.request(' P-110 ', 'en');

      expect(second.status).toBe(200);
      expect(PricingSearchResponseSchema.parse(await second.json())).toEqual(body);
      expect(search.transport.queries).toEqual(['!id:P-110']);
      expect(await db.query.cardPriceSearch.findMany()).toHaveLength(2);
    },
  );

  integrationTest('keeps an empty provider promo search empty', async ({ createApp, user, db }) => {
    const search = createSearchApp({
      createApp,
      user,
      game: 'one_piece',
      expectedQuery: '!id:P-110',
      cards: [],
    });

    const response = await search.request('p-110');

    expect(response.status).toBe(200);
    expect(PricingSearchResponseSchema.parse(await response.json())).toEqual({ matches: [], next_cursor: null });
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
      async ({ createApp, user, db }) => {
        await db.insert(cardPriceSearch).values({
          game: 'pokemon',
          pricingSource: 'scrydex_real',
          queryKey: oldKey,
          pricedOn: todayUTC(),
          pricingCardIds: [],
        });
        const search = createSearchApp({ createApp, user, expectedQuery, cards: [TORCHIC_PROMO] });
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
            where: {
              queryKey: searchPageKey(
                queryKey('pokemon', 'mep 056', { languages: parseCardLanguages(languages), searchBy: 'card' }),
                0,
              ),
            },
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

  integrationTest('applies the English filter before requesting provider results', async ({ createApp, user, db }) => {
    const card = { id: 'sv5-163', name: 'Shiftry', number: '163', language_code: 'EN' };
    const expectedQuery = '(name:"Shiftry") AND (!language_code:EN)';
    const search = createSearchApp({ createApp, user, expectedQuery, cards: [card] });

    const response = await search.request('Shiftry', 'en');

    expect(response.status).toBe(200);
    expect(PricingSearchResponseSchema.parse(await response.json()).matches).toHaveLength(1);
    expect(search.transport.queries).toEqual([expectedQuery]);
    expect(
      await db.query.cardPriceSearch.findFirst({
        where: { queryKey: searchPageKey(queryKey('pokemon', 'Shiftry', { languages: ['en'], searchBy: 'card' }), 0) },
      }),
    ).toMatchObject({ pricingCardIds: [card.id] });
  });

  integrationTest('applies the Japanese filter before requesting provider results', async ({ createApp, user, db }) => {
    const card = SHIFTRY;
    const expectedQuery = '(name:"Shiftry") AND (!language_code:JA)';
    const search = createSearchApp({ createApp, user, expectedQuery, cards: [card] });

    const response = await search.request('Shiftry', 'ja');

    expect(response.status).toBe(200);
    expect(PricingSearchResponseSchema.parse(await response.json()).matches).toHaveLength(1);
    expect(search.transport.queries).toEqual([expectedQuery]);
    expect(
      await db.query.cardPriceSearch.findFirst({
        where: { queryKey: searchPageKey(queryKey('pokemon', 'Shiftry', { languages: ['ja'], searchBy: 'card' }), 0) },
      }),
    ).toMatchObject({ pricingCardIds: [card.id] });
  });

  integrationTest(
    'finds Japanese Shiftry by set code and printed number and persists its identity',
    async ({ createApp, user, db }) => {
      const search = createSearchApp({
        createApp,
        user,
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
        await db.query.cardPriceSearch.findFirst({
          where: {
            queryKey: searchPageKey(queryKey('pokemon', 'sv5m 072/071', { languages: [], searchBy: 'card' }), 0),
          },
        }),
      ).toMatchObject({
        pricingSource: 'scrydex_real',
        pricingCardIds: ['sv5m_ja-72'],
      });
    },
  );

  integrationTest('finds a Japanese card by explicit expansion ID and unpadded number', async ({ createApp, user }) => {
    const search = createSearchApp({
      createApp,
      user,
      expectedQuery: '!expansion.id:sv5m_ja AND !number:72',
      cards: [SHIFTRY],
    });

    const response = await search.request('  SV5M_JA   072  ');

    expect(response.status).toBe(200);
    expect(PricingSearchResponseSchema.parse(await response.json()).matches).toMatchObject([
      { name: 'ダーテング', card_number: '072/071' },
    ]);
    expect(search.transport.queries).toEqual(['!expansion.id:sv5m_ja AND !number:72']);
  });

  integrationTest(
    'matches Japanese cards through their English translated name using the provider name index',
    async ({ createApp, user }) => {
      const search = createSearchApp({
        createApp,
        user,
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
    async ({ createApp, user }) => {
      const nativeCard = { id: 'sv5m_ja-72', name: 'ダーテング', number: '72', printed_number: '072/071' };

      const search = createSearchApp({
        createApp,
        user,
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
    async ({ createApp, user, db }) => {
      const englishCard = {
        id: 'sv5-163',
        name: 'Shiftry',
        number: '163',
        printed_number: '163/162',
        language_code: 'EN',
      };

      const search = createSearchApp({
        createApp,
        user,
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

  integrationTest('returns no matches when the printed denominator differs', async ({ createApp, user, db }) => {
    const search = createSearchApp({
      createApp,
      user,
      expectedQuery: SET_AND_PRINTED_NUMBER,
      cards: [SHIFTRY],
    });

    const response = await search.request('sv5m 072/070');

    expect(response.status).toBe(200);
    expect(PricingSearchResponseSchema.parse(await response.json())).toEqual({ matches: [], next_cursor: null });
    expect(search.transport.queries).toEqual([
      '(!expansion.id:sv5m OR !expansion.id:sv5m_ja) AND !printed_number:"072/070"',
    ]);
    expect(await db.query.cardPrice.findMany()).toEqual([]);
  });

  integrationTest(
    'reuses persisted search results without another provider request',
    async ({ createApp, user, db }) => {
      const search = createSearchApp({
        createApp,
        user,
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
    },
  );

  integrationTest(
    'refreshes a cached Japanese promo miss using the printed suffix and expansion',
    async ({ createApp, user, db }) => {
      await db.insert(cardPriceSearch).values({
        game: 'pokemon',
        pricingSource: 'scrydex_real',
        queryKey: searchPageKey('pokemon|v4|265/s-p', 0),
        pricedOn: todayUTC(),
        pricingCardIds: [],
      });

      const expectedQuery = '(!printed_number:"265/S-P" OR (!expansion.id:swshp_ja AND !number:265))';

      const search = createSearchApp({
        createApp,
        user,
        expectedQuery,
        cards: [
          {
            id: 'swshp_ja-265',
            name: 'ピカチュウVMAX',
            number: '265',
            artist: 'AKIRA EGAWA',
            language_code: 'JA',
            expansion: { id: 'swshp_ja', name: 'Sword & Shield Promos' },
            translation: { en: { name: 'Pikachu VMAX' } },
          },
        ],
      });

      const response = await search.request('265/S-P');

      expect(response.status).toBe(200);
      expect(PricingSearchResponseSchema.parse(await response.json()).matches).toMatchObject([
        { name: 'ピカチュウVMAX', card_number: '265', illustrator: 'AKIRA EGAWA' },
      ]);
      expect(search.transport.queries).toEqual([expectedQuery]);
      expect(
        await db.query.cardPriceSearch.findFirst({ where: { queryKey: searchPageKey('pokemon|v5|265/s-p', 0) } }),
      ).toMatchObject({ pricingCardIds: ['swshp_ja-265'] });
    },
  );

  integrationTest(
    'ignores empty search results cached under the previous query version',
    async ({ createApp, user, db }) => {
      await db.insert(cardPriceSearch).values({
        game: 'pokemon',
        pricingSource: 'scrydex_real',
        queryKey: 'pokemon|sv5m 072/071',
        pricedOn: todayUTC(),
        pricingCardIds: [],
      });

      const search = createSearchApp({
        createApp,
        user,
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
  createApp: (overrides?: ConstructorParameters<typeof App>[0]) => App['app'];
  user: Awaited<ReturnType<typeof createTestUser>>;
  expectedQuery: string | string[];
  cards: ScrydexRawCard[];
}

function createSearchApp({ createApp, user, expectedQuery, cards, game = 'pokemon' }: SearchAppOptions) {
  const transport = new ScrydexSearchTransport(
    Array.isArray(expectedQuery) ? expectedQuery : [expectedQuery],
    cards,
    game,
  );

  const pricingClient = createTestScrydexClient(transport.fetch, { baseURL: 'https://scrydex.test' });

  const app = createApp({ pricingClient });

  return {
    app,
    user,
    transport,
    request: (query: string, languages = '') => {
      return app.request(
        `${SEARCH_PRICING_ROUTE_PATH}?${new URLSearchParams({ game, query, languages, search_by: 'card' })}`,
        {
          headers: sessionHeaders(user.sessionToken),
        },
      );
    },
  };
}

class ScrydexSearchTransport {
  readonly queries: string[] = [];
  readonly paths: string[] = [];

  constructor(
    private readonly expectedQueries: string[],
    private readonly cards: ScrydexRawCard[],
    private readonly game: CardGame,
  ) {}

  readonly fetch: typeof fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const query = url.searchParams.get('q') ?? '';
    this.queries.push(query);
    this.paths.push(url.pathname);
    const expectedPath = this.game === 'pokemon' ? '/pokemon/v1/cards' : '/onepiece/v1/cards';
    const data = url.pathname === expectedPath && this.expectedQueries.includes(query) ? this.cards : [];

    return Response.json({ data, total_count: data.length });
  };
}

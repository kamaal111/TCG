import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { writeCatalog } from '../../../scripts/card-catalog-file.ts';
import { catalogPrintings } from '../../card-pricing/catalog-metadata.ts';
import { PRICING_SOURCES } from '../../card-pricing/types.ts';
import { card, cardConditionQuantity } from '../../db/schema/cards.ts';
import { SQLiteCardCatalog } from '../../persistence/sqlite/card-catalog.ts';
import { sessionHeaders } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { SET_CHECKLIST_FILTER_MAP, SET_LIST_SECTION_MAP } from '../constants.ts';

integrationTest(
  'lists catalog sets and paginates filtered ownership for the current account',
  async ({ createApp, createUser, user, db, authenticatedHeaders }) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-set-test-'));
    const file = path.join(directory, 'catalog.sqlite');

    try {
      const searchPrintings = [
        ...catalogPrintings(
          'pokemon',
          PRICING_SOURCES.SCRYDEX_REAL,
          {
            id: 'me2pt5-1',
            name: 'Oddish',
            number: '1',
            language_code: 'EN',
            expansion: { id: 'me2pt5', name: 'Ascended Heroes' },
          },
          new Map(),
        ),
        ...catalogPrintings(
          'one_piece',
          PRICING_SOURCES.SCRYDEX_REAL,
          {
            id: 'OP01-016',
            name: 'Nami',
            number: '16',
            language_code: 'EN',
            expansion: { id: 'OP01', name: 'Romance Dawn' },
          },
          new Map(),
        ),
      ];

      const expansions = [
        { game: 'pokemon' as const, id: 'me2pt5', name: 'Ascended Heroes', aliases: [], code: 'ASC' },
        { game: 'pokemon' as const, id: 'promo', name: 'Single Promo', aliases: [] },
        ...Array.from({ length: 30 }, (_, index) => ({
          game: 'pokemon' as const,
          id: `test-${index}`,
          name: `Test Set ${index}`,
          aliases: [],
        })),
        { game: 'one_piece' as const, id: 'op01', name: 'Romance Dawn', aliases: [] },
        { game: 'one_piece' as const, id: 'prb01', name: 'The Best', aliases: [] },
      ];

      const printings = Array.from({ length: 32 }, (_, index) => {
        const number = String(index + 1);

        return {
          game: 'pokemon' as const,
          setId: 'me2pt5',
          pricingId: `me2pt5-${number}`,
          name: 'Oddish',
          number: index === 31 ? '032/030' : number,
          printedNumber: `${number}/30`,
        };
      });

      const reprints = ['op01', 'prb01'].map(setId => ({
        game: 'one_piece' as const,
        setId,
        pricingId: 'OP01-016',
        name: 'Nami',
        number: 'OP01-016',
        printedNumber: 'OP01-016',
      }));

      const extra = [
        {
          game: 'pokemon' as const,
          setId: 'promo',
          pricingId: 'promo-1',
          name: 'Promo',
          number: '1',
          printedNumber: '1',
        },
        {
          game: 'one_piece' as const,
          setId: 'prb01',
          pricingId: 'OP01-017:altart',
          name: 'Alt-art Nami',
          number: 'OP01-017',
          printedNumber: 'OP01-017',
        },
      ];

      await writeCatalog(file, searchPrintings, undefined, {
        expansions,
        printings: [...printings, ...reprints, ...extra],
      });
      using catalog = new SQLiteCardCatalog(file);
      const app = createApp({ cardCatalog: catalog });
      const other = await createUser({});

      const add = async (
        userId: string,
        game: 'pokemon' | 'one_piece',
        number: string,
        pricingCardId: string | null,
      ) => {
        const id = crypto.randomUUID();
        await db.insert(card).values({
          id,
          userId,
          game,
          name: game === 'pokemon' ? 'Oddish' : 'Nami',
          setName: game === 'pokemon' ? 'Ascended Heroes' : 'Romance Dawn',
          cardNumber: number,
          pricingCardId,
          pricingSource: pricingCardId != null ? PRICING_SOURCES.SCRYDEX_REAL : null,
        });
        await db.insert(cardConditionQuantity).values({ cardId: id, condition: 'near_mint', quantity: 1 });
      };

      await add(user.userId, 'pokemon', '001/030', null);
      await add(user.userId, 'pokemon', '1/30', 'me2pt5-1');
      await add(other.userId, 'pokemon', '2/30', 'me2pt5-2');
      await add(user.userId, 'one_piece', 'OP01-016', 'OP01-016');
      await add(user.userId, 'one_piece', 'OP01-017', 'OP01-017:altart');

      const request = (route: string) => app.request(route, { headers: authenticatedHeaders });

      const list = await request(
        `/app-api/sets?game=pokemon&query=ascended&section=${SET_LIST_SECTION_MAP.IN_PROGRESS}`,
      );

      expect(list.status).toBe(200);
      expect(await list.json()).toEqual({
        entries: [expect.objectContaining({ id: 'me2pt5', collected: 1, total: 32 })],
        next_cursor: null,
      });

      const route = '/app-api/sets/pokemon/me2pt5/cards';
      const missing = await request(`${route}?filter=${SET_CHECKLIST_FILTER_MAP.MISSING}`);
      expect(missing.status).toBe(200);
      const first = await missing.json();
      expect(first.entries).toHaveLength(30);
      expect(first.entries[0]).toMatchObject({ number: '2', owned: false });
      expect(first.entries[29]).toMatchObject({ number: '31' });
      expect(first.set).toMatchObject({ collected: 1, total: 32 });
      const cursor = encodeURIComponent(first.next_cursor);
      const last = await request(`${route}?filter=${SET_CHECKLIST_FILTER_MAP.MISSING}&cursor=${cursor}`);
      expect(await last.json()).toMatchObject({ entries: [{ number: '32' }], next_cursor: null });
      expect((await request(`${route}?filter=${SET_CHECKLIST_FILTER_MAP.OWNED}&cursor=${cursor}`)).status).toBe(400);

      const checklist = await request(route);
      const checklistPage = await checklist.json();
      expect(checklistPage.next_cursor).toEqual(expect.any(String));
      const checklistCursor = encodeURIComponent(checklistPage.next_cursor);
      expect((await request(`/app-api/sets?game=pokemon&query=me2pt5&cursor=${checklistCursor}`)).status).toBe(400);

      const otherOwned = await app.request(`${route}?filter=${SET_CHECKLIST_FILTER_MAP.OWNED}`, {
        headers: sessionHeaders(other.sessionToken),
      });

      expect(await otherOwned.json()).toMatchObject({ entries: [{ number: '2', owned: true }] });
      const onePiece = await request('/app-api/sets?game=one_piece');
      expect(await onePiece.json()).toMatchObject({
        entries: [
          { id: 'op01', collected: 1, total: 1 },
          { id: 'prb01', collected: 2, total: 2 },
        ],
      });
      const promo = `/app-api/sets/pokemon/promo/cards?filter=${SET_CHECKLIST_FILTER_MAP.MISSING}`;
      expect(await (await request(promo)).json()).toMatchObject({
        entries: [{ number: '1', owned: false }],
        set: { collected: 0, total: 1 },
      });
      await add(user.userId, 'pokemon', '1', 'promo-1');
      expect(await (await request(promo)).json()).toMatchObject({ entries: [], set: { collected: 1, total: 1 } });
      expect((await app.request(route)).status).toBe(401);
      expect((await request('/app-api/sets/pokemon/unknown/cards')).status).toBe(404);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sqlite from 'node:sqlite';

import { ScrydexClient, type ScrydexFetch } from '@tcg/scrydex';

import { writeCatalog } from '../../../scripts/card-catalog-file.ts';
import { fetchCatalogDelta } from '../../../scripts/card-catalog-refresh.ts';
import { verifyReleaseSetInventory } from '../../../scripts/card-catalog-release.ts';
import { SQLiteCardCatalog } from '../../persistence/sqlite/card-catalog.ts';
import { buildCatalogQuery } from '../catalog-query.ts';
import type { CatalogPrinting } from '../catalog.ts';
import { CARD_GAME_MAP } from '../types.ts';

const printing = {
  game: CARD_GAME_MAP.ONE_PIECE,
  providerId: 'OP01-016',
  pricingId: 'OP01-016',
  language: 'en',
  names: ['nami'],
  nameTokens: ['nami'],
  setTokens: ['romance'],
  setIds: ['op01'],
  setKey: 'op01',
  setName: 'Romance Dawn',
  primarySet: true,
  collectorNumber: '16',
  printedNumber: 'OP01-016',
} satisfies CatalogPrinting;

async function makeFiles() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-catalog-update-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  const parent = path.join(directory, 'parent.sqlite');
  const output = path.join(directory, 'output.sqlite');

  await writeCatalog(parent, [printing, { ...printing, game: CARD_GAME_MAP.POKEMON }]);

  return { parent, output };
}

it('merges local rows into a new snapshot without duplicating printings or changing the parent', async () => {
  const { parent, output } = await makeFiles();

  const added = {
    ...printing,
    setKey: 'prb01',
    setIds: ['prb01'],
    setTokens: ['premium'],
    setName: 'Premium Booster',
    primarySet: false,
  };

  await writeCatalog(output, [added, added], parent);

  using previous = new SQLiteCardCatalog(parent);
  using current = new SQLiteCardCatalog(output);

  const query = {
    game: CARD_GAME_MAP.ONE_PIECE,
    query: buildCatalogQuery(CARD_GAME_MAP.ONE_PIECE, 'nami premium'),
    languages: [],
    offset: 0,
  };

  expect(previous.search(query).printings).toEqual([]);
  expect(current.search(query).printings).toEqual([
    { pricingId: 'OP01-016', providerId: 'OP01-016', setName: 'Premium Booster' },
  ]);
  expect(current.version).not.toBe(previous.version);
  await expect(writeCatalog(output, [added], parent)).rejects.toMatchObject({ code: 'EEXIST' });
});

it('upgrades a version-one copy without changing the parent or its search results', async () => {
  const { parent, output } = await makeFiles();

  {
    using db = new sqlite.DatabaseSync(parent);
    db.exec('DROP TABLE set_printing; DROP TABLE expansion; PRAGMA user_version = 1');
  }

  await fs.chmod(parent, 0o400);
  const before = await fs.readFile(parent);

  const inventory = {
    expansions: [{ game: CARD_GAME_MAP.ONE_PIECE, id: 'op01', name: 'Romance Dawn', aliases: [] }],
    printings: [
      {
        game: CARD_GAME_MAP.ONE_PIECE,
        setId: 'op01',
        pricingId: 'OP01-016',
        name: 'Nami',
        number: 'OP01-016',
        printedNumber: 'OP01-016',
      },
    ],
  };

  await writeCatalog(output, [], parent, inventory);
  using previous = new SQLiteCardCatalog(parent);
  using upgraded = new SQLiteCardCatalog(output);

  const query = {
    game: CARD_GAME_MAP.ONE_PIECE,
    query: buildCatalogQuery(CARD_GAME_MAP.ONE_PIECE, 'nami romance'),
    languages: [],
    offset: 0,
  };

  expect(await fs.readFile(parent)).toEqual(before);
  expect(previous.setInventory(CARD_GAME_MAP.ONE_PIECE)).toBeUndefined();
  expect(upgraded.setInventory(CARD_GAME_MAP.ONE_PIECE)?.printings).toMatchObject(inventory.printings);
  expect(upgraded.search(query)).toEqual(previous.search(query));
  expect(upgraded.search(query).printings).toHaveLength(1);
});

it('rejects a searchable catalog without set printings for every game', async () => {
  const { parent, output } = await makeFiles();

  await writeCatalog(output, [], parent, {
    expansions: [
      { game: CARD_GAME_MAP.POKEMON, id: 'base', name: 'Base Set', aliases: [] },
      { game: CARD_GAME_MAP.ONE_PIECE, id: 'op01', name: 'Romance Dawn', aliases: [] },
    ],
    printings: [
      {
        game: CARD_GAME_MAP.POKEMON,
        setId: 'base',
        pricingId: 'base-1',
        name: 'Alakazam',
        number: '1',
        printedNumber: '1/102',
      },
    ],
  });

  using searchOnly = new SQLiteCardCatalog(parent);
  using partial = new SQLiteCardCatalog(output);

  expect(() => verifyReleaseSetInventory(searchOnly)).toThrow('Card catalog is missing set checklist data');
  expect(() => verifyReleaseSetInventory(partial)).toThrow('Card catalog is missing set checklist data for one_piece');
});

it('stops after the allotted targeted metadata request and leaves the parent unchanged', async () => {
  const { parent } = await makeFiles();
  const previous = await fs.readFile(parent);
  const fetch = vi.fn<ScrydexFetch>().mockResolvedValue(Response.json({ totalCount: 125, data: [{ id: 'OP01-016' }] }));
  const client = new ScrydexClient({ apiKey: 'test', teamId: 'test', fetch });

  await expect(
    fetchCatalogDelta({
      parent,
      game: CARD_GAME_MAP.ONE_PIECE,
      cards: [],
      expansions: ['PRB01'],
      budget: 1,
      local: [],
      client,
    }),
  ).rejects.toThrow('Catalog request budget exhausted');

  expect(fetch).toHaveBeenCalledOnce();

  const address = fetch.mock.calls[0]?.[0];
  assert(address instanceof URL);

  expect(address.searchParams.get('q')).toBe('printings:PRB01');
  expect(address.searchParams.has('include')).toBe(false);
  expect(await fs.readFile(parent)).toEqual(previous);
});

it('rejects a corrupt catalog file before search can use it', async () => {
  const { output } = await makeFiles();
  await fs.writeFile(output, 'this file is not SQLite');

  expect(() => new SQLiteCardCatalog(output)).toThrow('Could not verify SQLite card catalog');
});

it('adds a scoped One Piece reprint while keeping the original set searchable', async () => {
  const { parent, output } = await makeFiles();

  const fetch = vi
    .fn<ScrydexFetch>()
    .mockResolvedValueOnce(
      Response.json({
        totalCount: 1,
        data: [
          {
            id: 'OP01-016',
            name: 'Nami',
            number: '16',
            printed_number: 'OP01-016',
            language_code: 'EN',
            expansion: { id: 'OP01', name: 'Romance Dawn' },
            variants: [
              { name: 'normal', printings: ['OP01'] },
              { name: 'foil', printings: ['PRB01'] },
            ],
          },
        ],
      }),
    )
    .mockResolvedValueOnce(Response.json({ totalCount: 1, data: [{ id: 'PRB01', name: 'Premium Booster' }] }));

  const client = new ScrydexClient({ apiKey: 'test', teamId: 'test', fetch });

  const delta = await fetchCatalogDelta({
    parent,
    game: CARD_GAME_MAP.ONE_PIECE,
    cards: [],
    expansions: ['PRB01'],
    budget: 2,
    local: [],
    client,
  });

  expect(delta.requests).toBe(2);
  expect(delta.rows).toMatchObject([{ setKey: 'prb01', setName: 'Premium Booster' }]);
  await writeCatalog(output, delta.rows, parent);
  using catalog = new SQLiteCardCatalog(output);

  expect(
    catalog.search({
      game: CARD_GAME_MAP.ONE_PIECE,
      query: buildCatalogQuery(CARD_GAME_MAP.ONE_PIECE, 'nami romance'),
      languages: [],
      offset: 0,
    }).printings,
  ).toEqual([{ pricingId: 'OP01-016', providerId: 'OP01-016', setName: 'Romance Dawn' }]);
});

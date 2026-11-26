import sqlite from 'node:sqlite';

import { InternalServerError } from '@tcg/http/exceptions';
import {
  SCRYDEX_CATALOG_COLLECTION_MAP,
  SCRYDEX_FIRST_PAGE,
  type ScrydexClient,
  type ScrydexCatalogCollection,
  type ScrydexRawCard,
} from '@tcg/scrydex';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { z } from 'zod';

import { catalogExpansions, catalogPrintings } from '../src/card-pricing/catalog-metadata.ts';
import type { CatalogPrinting } from '../src/card-pricing/catalog.ts';
import { buildScrydexIdBatches } from '../src/card-pricing/scrydex/query.ts';
import { CARD_GAME_MAP, PRICING_SOURCES, type CardGame } from '../src/card-pricing/types.ts';
import { SQLiteCardCatalog, catalogPrintingTable } from '../src/persistence/sqlite/card-catalog.ts';

const ScopedIdSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

const ExistingSetSchema = z.object({
  setKey: z.string(),
  setName: z.string().nullable(),
  setIds: z.string(),
  setTokens: z.string(),
});

const ListSchema = z.array(z.string());

interface CatalogRefreshOptions {
  parent: string;
  game: CardGame;
  cards: readonly string[];
  expansions: readonly string[];
  budget: number;
  local: readonly CatalogPrinting[];
  client: ScrydexClient;
}

export async function fetchCatalogDelta({
  parent,
  game,
  cards,
  expansions,
  budget,
  local,
  client,
}: CatalogRefreshOptions) {
  using _catalog = new SQLiteCardCatalog(parent);
  using db = new sqlite.DatabaseSync(parent, { readOnly: true });
  const requestedExpansions = new Set(expansions.map(id => ScopedIdSchema.parse(id)));
  let requests = 0;

  async function fetchScope(collection: ScrydexCatalogCollection, query: string) {
    const seen = new Set<string>();
    const collected: ScrydexRawCard[] = [];
    let total: number | undefined;

    for (let page = SCRYDEX_FIRST_PAGE; ; page += 1) {
      if (requests >= budget) {
        throw new InternalServerError(undefined, { diagnosticMessage: 'Catalog request budget exhausted' });
      }

      requests += 1;
      const result = await client.listCatalog(game, collection, query, page);

      if (result.isErr()) {
        throw new InternalServerError(undefined, { diagnosticMessage: result.error.message });
      }

      const { catalogTotal, rejectedCount, cards: records, hasMore } = result.value;
      total ??= catalogTotal;

      if (catalogTotal == null || catalogTotal !== total || records.length === 0 || rejectedCount !== 0) {
        throw new InternalServerError(undefined, { diagnosticMessage: 'Incomplete scoped catalog response' });
      }

      for (const record of records) {
        const id = z.string().trim().nonempty().parse(record.id);

        if (seen.has(id)) {
          throw new InternalServerError(undefined, { diagnosticMessage: 'Duplicate ID in scoped catalog response' });
        }

        collected.push(record);
        seen.add(id);
      }

      if (hasMore ? seen.size >= catalogTotal : seen.size !== catalogTotal) {
        throw new InternalServerError(undefined, {
          diagnosticMessage: 'Scoped catalog count does not match the response pages',
        });
      }

      if (!hasMore) {
        return collected;
      }
    }
  }

  const rows: CatalogPrinting[] = [];
  const known = new Map<string, Pick<CatalogPrinting, 'setKey' | 'setName' | 'setIds' | 'setTokens'>>();

  const { game: printingGame, setKey, setName, setIds, setTokens, primarySet } = catalogPrintingTable;

  const sets = drizzle({ client: db })
    .selectDistinct({ setKey, setName, setIds, setTokens })
    .from(catalogPrintingTable)
    .where(eq(printingGame, game))
    .orderBy(desc(primarySet), setKey)
    .all();

  for (const raw of sets) {
    const row = ExistingSetSchema.parse(raw);

    const set = {
      ...row,
      setIds: ListSchema.parse(JSON.parse(row.setIds)),
      setTokens: row.setTokens.split(' ').filter(Boolean),
    };

    for (const id of [set.setKey, ...set.setIds]) {
      if (!known.has(id)) {
        known.set(id, set);
      }
    }
  }

  for (const row of local) {
    if (row.game === game) {
      for (const id of [row.setKey, ...row.setIds]) {
        known.set(id, row);
      }
    }
  }

  const addRows = (record: ScrydexRawCard, expansions: ReturnType<typeof catalogExpansions>) => {
    const normalized = catalogPrintings(game, PRICING_SOURCES.SCRYDEX_REAL, record, expansions);

    return normalized.map(row => {
      const set = known.get(row.setKey);

      return set == null
        ? row
        : { ...row, setKey: set.setKey, setName: set.setName, setIds: set.setIds, setTokens: set.setTokens };
    });
  };

  const requestedCards = new Set(cards)
    .values()
    .map(id => ScopedIdSchema.parse(id))
    .filter(id => !local.some(row => row.game === game && row.providerId === id))
    .toArray();

  const batches = buildScrydexIdBatches(requestedCards);

  if (batches == null) {
    throw new InternalServerError(undefined, { diagnosticMessage: 'Scoped card ID exceeds provider query limit' });
  }

  for (const { ids, query } of batches) {
    const records = await fetchScope(SCRYDEX_CATALOG_COLLECTION_MAP.CARDS, query);

    if (records.length !== ids.size || records.some(record => !ids.has(z.string().parse(record.id)))) {
      throw new InternalServerError(undefined, {
        diagnosticMessage: 'Scoped card response does not match the requested IDs',
      });
    }

    for (const record of records) {
      const matches = addRows(record, new Map());

      if (matches.length === 0) {
        throw new InternalServerError(undefined, { diagnosticMessage: 'Scoped card had no usable printing' });
      }

      rows.push(...matches);
    }
  }

  for (const id of requestedExpansions) {
    const key = id.toLowerCase();
    const filter = game === CARD_GAME_MAP.ONE_PIECE ? `printings:${id}` : `!expansion.id:${id}`;
    const records = await fetchScope(SCRYDEX_CATALOG_COLLECTION_MAP.CARDS, filter);

    const needsName =
      !known.has(key) &&
      records.every(record => z.string().safeParse(record.expansion?.id).data?.toLowerCase() !== key);

    const metadata = needsName ? await fetchScope(SCRYDEX_CATALOG_COLLECTION_MAP.EXPANSIONS, `!id:${id}`) : [];
    const setIndex = catalogExpansions(metadata);

    const matches = records
      .flatMap(record => addRows(record, setIndex))
      .filter(row => row.setKey === key || row.setIds.includes(key));

    if (matches.length === 0) {
      throw new InternalServerError(undefined, { diagnosticMessage: 'Scoped expansion had no usable printings' });
    }

    rows.push(...matches);
  }

  return { rows, requests };
}

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sqlite from 'node:sqlite';

import type { CatalogPrinting } from '../src/card-pricing/catalog.ts';
import {
  SQLiteCardCatalog,
  initializeCatalogSchema,
  upgradeCatalogSchema,
} from '../src/persistence/sqlite/card-catalog.ts';
import type { SetInventory } from '../src/sets/catalog.ts';

export async function writeCatalog(
  file: string,
  printings: readonly CatalogPrinting[],
  parent?: string,
  inventory?: SetInventory,
): Promise<void> {
  const temporary = await fs.mkdtemp(path.join(path.dirname(file), '.catalog-'));
  const target = path.join(temporary, 'catalog.sqlite');

  try {
    if (parent != null) {
      using _previous = new SQLiteCardCatalog(parent);
      await fs.copyFile(parent, target);
      await fs.chmod(target, 0o600);
    }

    using db = new sqlite.DatabaseSync(target);

    if (parent == null) {
      initializeCatalogSchema(db);
    }

    db.exec('BEGIN');

    if (inventory != null) {
      upgradeCatalogSchema(db);
      db.exec('DELETE FROM set_printing; DELETE FROM expansion;');
      const insertExpansion = db.prepare('INSERT INTO expansion VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

      for (const { game, id, name, aliases, code, language, releaseDate, logo, symbol } of inventory.expansions) {
        insertExpansion.run(
          game,
          id,
          name,
          JSON.stringify(aliases),
          code ?? null,
          language ?? null,
          releaseDate ?? null,
          logo ?? null,
          symbol ?? null,
        );
      }

      const insertPrinting = db.prepare('INSERT INTO set_printing VALUES (?, ?, ?, ?, ?, ?, ?)');

      for (const { game, setId, pricingId, number, name, printedNumber, image } of inventory.printings) {
        insertPrinting.run(game, setId, pricingId, number, name, printedNumber, image ?? null);
      }
    }

    const insert = db.prepare(`
      INSERT INTO printing (game, pricing_id, provider_id, language, names, name_tokens, set_tokens,
        set_ids, set_key, set_name, primary_set, collector_number, printed_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (game, pricing_id, set_key) DO UPDATE SET provider_id=excluded.provider_id,
        language=excluded.language, names=excluded.names, name_tokens=excluded.name_tokens,
        set_tokens=excluded.set_tokens, set_ids=excluded.set_ids, set_name=excluded.set_name,
        primary_set=excluded.primary_set, collector_number=excluded.collector_number, printed_number=excluded.printed_number
    `);

    for (const printing of printings) {
      insert.run(
        printing.game,
        printing.pricingId,
        printing.providerId,
        printing.language,
        JSON.stringify(printing.names),
        printing.nameTokens.join(' '),
        printing.setTokens.join(' '),
        JSON.stringify(printing.setIds),
        printing.setKey,
        printing.setName ?? null,
        Number(printing.primarySet),
        printing.collectorNumber,
        printing.printedNumber,
      );
    }

    db.exec("INSERT INTO catalog_fts(catalog_fts) VALUES('rebuild'); DELETE FROM catalog_version;");
    db.prepare('INSERT INTO catalog_version VALUES (?)').run(crypto.randomUUID());
    db.exec("INSERT INTO catalog_fts(catalog_fts, rank) VALUES ('integrity-check', 1); COMMIT;");

    using _catalog = new SQLiteCardCatalog(target);
    await fs.chmod(target, 0o600);
    await fs.link(target, file);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

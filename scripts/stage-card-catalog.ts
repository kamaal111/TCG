import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { InternalServerError } from '@tcg/http/exceptions';

import { cardCatalogSha256, readCardCatalogManifest } from './card-catalog-manifest.ts';
import { writeCatalog } from '../server/scripts/card-catalog-file.ts';
import { verifyReleaseSetInventory } from '../server/scripts/card-catalog-release.ts';
import { CatalogPrintingSchema } from '../server/src/card-pricing/catalog.ts';
import { SQLiteCardCatalog } from '../server/src/persistence/sqlite/card-catalog.ts';

const [mode, directory] = process.argv.slice(2);

if ((mode !== 'fixture' && mode !== 'pinned') || !directory) {
  throw new InternalServerError(undefined, { diagnosticMessage: 'Use stage-card-catalog.ts pinned|fixture DIRECTORY' });
}

const destination = path.resolve(directory);

await fs.mkdir(destination, { recursive: true });

const file = path.join(destination, 'catalog.sqlite');

if (mode === 'fixture') {
  const fixture = CatalogPrintingSchema.shape.game.options.map(game => ({
    game,
    providerId: 'fixture-1',
    pricingId: 'fixture-1',
    language: 'en',
    names: ['fixture'],
    nameTokens: ['fixture'],
    setTokens: ['set'],
    setIds: ['set'],
    setKey: 'set',
    setName: 'Set',
    primarySet: true,
    collectorNumber: '1',
    printedNumber: '1',
  }));

  await writeCatalog(file, fixture, undefined, {
    expansions: fixture.map(({ game, setKey: id, setName: name }) => ({ game, id, name, aliases: [] })),
    printings: fixture.map(({ game, setKey: setId, pricingId, collectorNumber: number, printedNumber }) => ({
      game,
      setId,
      pricingId,
      number,
      printedNumber,
      name: 'Fixture card',
    })),
  });

  using catalog = new SQLiteCardCatalog(file);
  verifyReleaseSetInventory(catalog);
} else {
  const manifest = await readCardCatalogManifest();

  async function openPinnedCatalog(path: string): Promise<SQLiteCardCatalog | undefined> {
    try {
      const digest = await cardCatalogSha256(path);

      if (digest !== manifest.sha256) {
        return undefined;
      }

      const catalog = new SQLiteCardCatalog(path);

      if (catalog.version === manifest.version) {
        return catalog;
      }

      catalog[Symbol.dispose]();
    } catch {
      return undefined;
    }

    return undefined;
  }

  using cached = await openPinnedCatalog(file);

  if (cached != null) {
    verifyReleaseSetInventory(cached);
  } else {
    const temporary = await fs.mkdtemp(path.join(destination, '.download-'));
    let container: string | undefined;

    try {
      childProcess.execFileSync('docker', ['pull', '--platform', 'linux/amd64', manifest.image], { stdio: 'inherit' });
      container = childProcess
        .execFileSync('docker', ['create', '--platform', 'linux/amd64', manifest.image], {
          encoding: 'utf8',
        })
        .trim();
      const staged = path.join(temporary, 'catalog.sqlite');
      childProcess.execFileSync('docker', ['cp', `${container}:/catalog.sqlite`, staged]);

      using catalog = await openPinnedCatalog(staged);

      if (catalog == null) {
        throw new InternalServerError(undefined, {
          diagnosticMessage: 'Pinned card catalog failed checksum or schema verification',
        });
      }

      verifyReleaseSetInventory(catalog);

      await fs.chmod(staged, 0o600);
      await fs.rename(staged, file);
    } finally {
      if (container) {
        childProcess.spawnSync('docker', ['rm', container], { stdio: 'ignore' });
      }

      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}

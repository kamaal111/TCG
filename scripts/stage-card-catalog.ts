import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { InternalServerError } from '@tcg/http/exceptions';

import { cardCatalogSha256, readCardCatalogManifest } from './card-catalog-manifest.ts';
import { writeCatalog } from '../server/scripts/card-catalog-file.ts';
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

  await writeCatalog(file, fixture);
} else {
  const manifest = await readCardCatalogManifest();

  async function verified(path: string) {
    try {
      const digest = await cardCatalogSha256(path);

      if (digest !== manifest.sha256) {
        return false;
      }

      using catalog = new SQLiteCardCatalog(path);

      return catalog.version === manifest.version;
    } catch {
      return false;
    }
  }

  if (!(await verified(file))) {
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

      if (!(await verified(staged))) {
        throw new InternalServerError(undefined, {
          diagnosticMessage: 'Pinned card catalog failed checksum or schema verification',
        });
      }

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

import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { z } from 'zod';

import { CardCatalogManifestSchema, cardCatalogSha256, readCardCatalogManifest } from './card-catalog-manifest.ts';
import { verifyReleaseSetInventory } from '../server/scripts/card-catalog-release.ts';
import { SQLiteCardCatalog } from '../server/src/persistence/sqlite/card-catalog.ts';

const PublishArgumentsSchema = z.tuple([z.string().nonempty(), z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}$/)]);

const BuildMetadataSchema = z.object({ 'containerimage.digest': z.string().regex(/^sha256:[a-f0-9]{64}$/) });

const [source, tag] = PublishArgumentsSchema.parse(process.argv.slice(2));
const manifest = await readCardCatalogManifest();
const repository = manifest.image.split('@', 1)[0];
const dockerfile = url.fileURLToPath(new URL('../server/Dockerfile.catalog', import.meta.url));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-catalog-publish-'));

try {
  const file = path.join(directory, 'catalog.sqlite');
  const metadata = path.join(directory, 'metadata.json');

  await fs.copyFile(source, file);

  using catalog = new SQLiteCardCatalog(file);
  verifyReleaseSetInventory(catalog);

  const sha256 = await cardCatalogSha256(file);

  console.error('Publishing verified catalog version', catalog.version);
  childProcess.execFileSync(
    'docker',
    [
      'buildx',
      'build',
      '--platform',
      'linux/amd64',
      '--provenance=false',
      '--push',
      '--file',
      dockerfile,
      '--metadata-file',
      metadata,
      '--tag',
      `${repository}:${tag}`,
      directory,
    ],
    { stdio: ['ignore', process.stderr, process.stderr] },
  );

  const build = BuildMetadataSchema.parse(JSON.parse(await fs.readFile(metadata, 'utf8')));

  const nextManifest = CardCatalogManifestSchema.parse({
    image: `${repository}@${build['containerimage.digest']}`,
    sha256,
    version: catalog.version,
  });

  console.log(JSON.stringify(nextManifest, null, 2));
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}

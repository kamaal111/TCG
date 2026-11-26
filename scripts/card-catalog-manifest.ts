import crypto from 'node:crypto';
import fs from 'node:fs/promises';

import { z } from 'zod';

export const CardCatalogManifestSchema = z.object({
  image: z.string().regex(/^ghcr\.io\/[a-z0-9_.-]+\/tcg-card-catalog@sha256:[a-f0-9]{64}$/),
  sha256: z.hash('sha256'),
  version: z.uuid(),
});

export async function readCardCatalogManifest() {
  const source = await fs.readFile(new URL('../server/card-catalog.json', import.meta.url), 'utf8');

  return CardCatalogManifestSchema.parse(JSON.parse(source));
}

export async function cardCatalogSha256(file: string) {
  return crypto.hash('sha256', await fs.readFile(file));
}

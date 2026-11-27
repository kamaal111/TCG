import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';

import { InternalServerError } from '@tcg/http/exceptions';
import { ScrydexClient } from '@tcg/scrydex';
import { z } from 'zod';

import { writeCatalog } from './card-catalog-file.ts';
import { fetchCatalogDelta } from './card-catalog-refresh.ts';
import { fetchSetInventory } from './set-catalog-refresh.ts';
import { CatalogPrintingSchema } from '../src/card-pricing/catalog.ts';

const ExportRowSchema = CatalogPrintingSchema.extend({ printingCount: z.int().positive() });

const CatalogDeltaSchema = z.array(CatalogPrintingSchema).nonempty();

const RequestLimitSchema = z.coerce.number().int().positive();

const ScrydexCredentialsSchema = z.object({
  SCRYDEX_API_KEY: z.string().nonempty(),
  SCRYDEX_TEAM_ID: z.string().nonempty(),
});

function createScrydexClient() {
  const { SCRYDEX_API_KEY: apiKey, SCRYDEX_TEAM_ID: teamId } = ScrydexCredentialsSchema.parse(process.env);

  return new ScrydexClient({ apiKey, teamId });
}

function validateExport(rows: readonly z.infer<typeof ExportRowSchema>[]) {
  for (const game of CatalogPrintingSchema.shape.game.options) {
    const gameRows = rows.filter(row => row.game === game);

    if (gameRows.length === 0 || gameRows.some(row => row.printingCount !== gameRows.length)) {
      throw new InternalServerError(undefined, {
        diagnosticMessage: `Incomplete catalog export for ${game}`,
      });
    }
  }

  return rows;
}

const options = util.parseArgs({
  options: {
    output: { type: 'string' },
    export: { type: 'string' },
    parent: { type: 'string' },
    delta: { type: 'string' },
    game: { type: 'string' },
    card: { type: 'string', multiple: true },
    expansion: { type: 'string', multiple: true },
    sets: { type: 'boolean' },
    'request-limit': { type: 'string' },
  },
}).values;

if (!options.output) {
  throw new InternalServerError(undefined, { diagnosticMessage: 'Specify --output for the new catalog file' });
}

const output = path.resolve(options.output);

const cards = options.card ?? [];
const expansions = options.expansion ?? [];
const fetchRequested = cards.length + expansions.length > 0;

if (options.sets) {
  if (!options.parent || options.export || options.delta || fetchRequested || options.game) {
    throw new InternalServerError(undefined, { diagnosticMessage: 'Use --sets with --parent and --request-limit' });
  }

  const client = createScrydexClient();
  const requestLimit = RequestLimitSchema.parse(options['request-limit']);
  const { inventory, requests, numberless } = await fetchSetInventory(client, requestLimit);

  await writeCatalog(output, [], options.parent, inventory);
  console.log(
    `Set catalog written with ${requests} Scrydex requests. Provider records without collector numbers: ${numberless}.`,
  );
} else if (options.parent && !options.export && (options.delta || fetchRequested)) {
  const delta = options.delta ? CatalogDeltaSchema.parse(JSON.parse(await fs.readFile(options.delta, 'utf8'))) : [];

  const fetched = fetchRequested
    ? await fetchCatalogDelta({
        parent: options.parent,
        game: CatalogPrintingSchema.shape.game.parse(options.game),
        cards,
        expansions,
        budget: RequestLimitSchema.parse(options['request-limit']),
        local: delta,
        client: createScrydexClient(),
      })
    : undefined;

  await writeCatalog(output, [...(fetched?.rows ?? []), ...delta], options.parent);
  console.log(`Catalog written with ${fetched?.requests ?? 0} Scrydex requests.`);
} else if (options.export && !options.parent && !options.delta && !fetchRequested) {
  const rows = (await fs.readFile(options.export, 'utf8'))
    .trim()
    .split('\n')
    .map(line => ExportRowSchema.parse(JSON.parse(line)));

  await writeCatalog(output, validateExport(rows));
} else {
  throw new InternalServerError(undefined, {
    diagnosticMessage: 'Specify --export FILE, or --parent FILE with a delta or scoped provider data',
  });
}

import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';

import { InternalServerError } from '@tcg/http/exceptions';
import { ScrydexClient } from '@tcg/scrydex';
import { z } from 'zod';

import { writeCatalog } from './card-catalog-file.ts';
import { fetchCatalogDelta } from './card-catalog-refresh.ts';
import { CatalogPrintingSchema } from '../src/card-pricing/catalog.ts';

const ExportRowSchema = CatalogPrintingSchema.extend({ printingCount: z.int().positive() });

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

if (options.parent && !options.export && (options.delta || fetchRequested)) {
  const delta = options.delta
    ? z
        .array(CatalogPrintingSchema)
        .nonempty()
        .parse(JSON.parse(await fs.readFile(options.delta, 'utf8')))
    : [];

  const fetched = fetchRequested
    ? await fetchCatalogDelta({
        parent: options.parent,
        game: CatalogPrintingSchema.shape.game.parse(options.game),
        cards,
        expansions,
        budget: z.coerce.number().int().positive().parse(options['request-limit']),
        local: delta,
        client: new ScrydexClient({
          apiKey: z.string().nonempty().parse(process.env.SCRYDEX_API_KEY),
          teamId: z.string().nonempty().parse(process.env.SCRYDEX_TEAM_ID),
        }),
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

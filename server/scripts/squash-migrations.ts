import path from 'node:path';
import readline from 'node:readline/promises';

import { migrationFailure, planSquash, readMigrationCatalog, squashMigrations } from '../src/db/migration-files.ts';

async function main(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    migrationFailure('Run just squash-migrations in an interactive terminal.');
  }

  const folder = path.resolve('drizzle');
  const catalog = await readMigrationCatalog(folder);

  if (catalog.active.length < 2) {
    migrationFailure('At least two active migrations are required to squash.');
  }

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('Choose an inclusive migration range. No database will be modified.');

    for (const [index, migration] of catalog.active.entries()) {
      console.log(`${index + 1}. ${migration.name}`);
    }

    const first = Number(await prompt.question('First migration number: '));
    const last = Number(await prompt.question('Last migration number: '));
    const start = catalog.active[first - 1];
    const end = catalog.active[last - 1];

    if (!Number.isInteger(first) || !Number.isInteger(last) || start == null || end == null || last <= first) {
      migrationFailure('Select an ordered range containing at least two migrations.');
    }

    const proposal = planSquash(catalog, start.name, end.name);
    console.log(
      `Combine ${last - first + 1} migrations, ${start.name} through ${end.name}, into ${proposal.migration.name}.`,
    );
    console.log('Original SQL will be retained in drizzle/compatibility/manifest.json for existing databases.');
    const confirmation = await prompt.question('Write this squash? [y/N] ');

    if (confirmation.trim().toLowerCase() !== 'y') {
      console.log('Cancelled. Migration files are unchanged.');

      return;
    }

    const name = await squashMigrations({
      folder,
      first: start.name,
      last: end.name,
      expectedRevision: catalog.revision,
    });

    console.log(
      `Created ${name}. Review and commit the migration folders and compatibility archive together. Use just migrate on every database.`,
    );
  } finally {
    prompt.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

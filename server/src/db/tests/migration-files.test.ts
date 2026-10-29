import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';

import { z } from 'zod';

import { migrationFixture, readTree } from './migration-fixture.ts';
import { readMigrationCatalog, squashMigrations } from '../migration-files.ts';

const execFile = util.promisify(childProcess.execFile);

test('squashes the current repository history without connecting to a database', async t => {
  const { folder } = await migrationFixture(t);
  await fs.rm(folder, { recursive: true });
  await fs.cp('./drizzle', folder, { recursive: true });
  const before = await readMigrationCatalog(folder);
  const first = z.string().parse(before.active[0]?.name);
  const last = z.string().parse(before.active.at(-1)?.name);
  const name = await squashMigrations({ folder, first, last });
  const after = await readMigrationCatalog(folder);
  expect(after.active.map(migration => migration.name)).toEqual([name]);
  expect(after.archive.replacements[0]?.sources).toEqual(before.active);
  expect(after.active[0]?.sql).toBe(before.active.map(migration => migration.sql).join('\n--> statement-breakpoint\n'));
});

test('preserves files and snapshot links outside a selected middle range', async t => {
  const { folder, names } = await migrationFixture(t);
  const before = await readTree(folder);
  const first = z.string().parse(names[1]);
  const last = z.string().parse(names[2]);
  const name = await squashMigrations({ folder, first, last });
  const after = await readTree(folder);
  const catalog = await readMigrationCatalog(folder);
  expect(catalog.active.map(migration => migration.name)).toEqual([names[0], name, names[3]]);
  expect(after[`${names[0]}/snapshot.json`]).toBe(before[`${names[0]}/snapshot.json`]);
  expect(after[`${names[3]}/snapshot.json`]).toBe(before[`${names[3]}/snapshot.json`]);
  expect(after[`${names[3]}/migration.sql`]).toBe(before[`${names[3]}/migration.sql`]);
});

test('retains earlier compatibility history when squashing a squash again', async t => {
  const { folder, names } = await migrationFixture(t);

  const baseline = await squashMigrations({
    folder,
    first: z.string().parse(names[0]),
    last: z.string().parse(names[1]),
  });

  const final = await squashMigrations({ folder, first: baseline, last: z.string().parse(names[3]) });
  const catalog = await readMigrationCatalog(folder);
  expect(catalog.active.map(migration => migration.name)).toEqual([final]);
  expect(catalog.archive.replacements).toHaveLength(2);
  expect(catalog.known.has(baseline)).toBe(true);
  expect(catalog.known.has(z.string().parse(names[0]))).toBe(true);
});

test.each([
  [1, 1],
  [2, 1],
  [0, 4],
] as const)('rejects invalid range %i through %i without changing files', async (first, last) => {
  const { folder, names } = await migrationFixture();
  const before = await readTree(folder);
  await expect(squashMigrations({ folder, first: String(names[first]), last: String(names[last]) })).rejects.toThrow(
    'ordered range',
  );
  expect(await readTree(folder)).toEqual(before);
});

test('rejects a corrupted compatibility archive before changing files', async t => {
  const { folder, names } = await migrationFixture(t);
  await squashMigrations({ folder, first: z.string().parse(names[0]), last: z.string().parse(names[1]) });
  const manifest = path.join(folder, 'compatibility', 'manifest.json');
  const content = await fs.readFile(manifest, 'utf8');
  await fs.writeFile(manifest, content.replace('CREATE TABLE', 'DROP TABLE'));
  await expect(readMigrationCatalog(folder)).rejects.toThrow('corrupt');
});

test('rejects broken snapshot links without replacing migrations', async t => {
  const { folder, names } = await migrationFixture(t);
  const snapshot = path.join(folder, z.string().parse(names[1]), 'snapshot.json');
  await fs.copyFile(path.join(folder, z.string().parse(names[0]), 'snapshot.json'), snapshot);
  const before = await readTree(folder);
  await expect(
    squashMigrations({ folder, first: z.string().parse(names[0]), last: z.string().parse(names[1]) }),
  ).rejects.toThrow('snapshot chain');
  expect(await readTree(folder)).toEqual(before);
});

test('preserves originals and supplies recovery instructions after an interrupted publication', async t => {
  const { root, folder } = await migrationFixture(t);
  const before = await readTree(folder);
  const workspace = path.join(root, '.drizzle-squash');
  await fs.mkdir(workspace);
  await fs.rename(folder, path.join(workspace, 'original'));
  await expect(readMigrationCatalog(folder)).rejects.toThrow('restore original/');
  expect(await readTree(path.join(workspace, 'original'))).toEqual(before);
});

test('refuses a concurrent squash without removing its workspace', async t => {
  const { root, folder, names } = await migrationFixture(t);
  const workspace = path.join(root, '.drizzle-squash');
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, 'sentinel'), 'owned by another process');
  const before = await readTree(folder);
  await expect(
    squashMigrations({ folder, first: z.string().parse(names[0]), last: z.string().parse(names[1]) }),
  ).rejects.toThrow('Another squash');
  expect(await fs.readFile(path.join(workspace, 'sentinel'), 'utf8')).toBe('owned by another process');
  expect(await readTree(folder)).toEqual(before);
});

test('refuses a noninteractive CLI invocation without changing migration files', async t => {
  const { folder } = await migrationFixture(t);
  const before = await readTree(folder);
  await expect(
    execFile(process.execPath, [path.resolve('scripts/squash-migrations.ts')], { cwd: path.dirname(folder) }),
  ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('interactive terminal') });
  expect(await readTree(folder)).toEqual(before);
});

async function interactiveSquash(folder: string, confirmation: string): Promise<string> {
  const script = String.raw`
import os, subprocess, sys
master, slave = os.openpty()
process = subprocess.Popen([sys.argv[1], sys.argv[2]], stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
output = b''
try:
    for marker, answer in [(b'First migration number:', b'2'), (b'Last migration number:', b'3'), (b'Write this squash?', sys.argv[3].encode())]:
        while marker not in output:
            output += os.read(master, 65536)
        os.write(master, answer + b'\n')
    try:
        while True:
            chunk = os.read(master, 65536)
            if not chunk:
                break
            output += chunk
    except OSError:
        pass
    code = process.wait(timeout=5)
    sys.stdout.buffer.write(output)
    sys.exit(code)
finally:
    os.close(master)
    if process.poll() is None:
        process.kill()
        process.wait()
`;

  const result = await execFile(
    'python3',
    ['-c', script, process.execPath, path.resolve('scripts/squash-migrations.ts'), confirmation],
    { cwd: path.dirname(folder), timeout: 10_000 },
  );

  return result.stdout;
}

test('cancels an interactive selection without changing files', async t => {
  const { folder } = await migrationFixture(t);
  const before = await readTree(folder);
  const output = await interactiveSquash(folder, 'n');
  expect(output).toContain('Cancelled. Migration files are unchanged.');
  expect(await readTree(folder)).toEqual(before);
});

test('previews and confirms the selected inclusive range in an interactive terminal', async t => {
  const { folder, names } = await migrationFixture(t);
  const output = await interactiveSquash(folder, 'y');
  const catalog = await readMigrationCatalog(folder);
  const replacement = z.string().parse(catalog.active[1]?.name);
  expect(catalog.active.map(migration => migration.name)).toEqual([names[0], replacement, names[3]]);
  expect(output).toContain(`into ${replacement}.`);
  expect(output).toContain(`Created ${replacement}.`);
});

test('generates a subsequent Drizzle migration using the squashed snapshot', async t => {
  const { root, folder } = await migrationFixture(t);
  await fs.rm(folder, { recursive: true });
  await fs.cp('./drizzle', folder, { recursive: true });
  const catalog = await readMigrationCatalog(folder);

  const replacement = await squashMigrations({
    folder,
    first: z.string().parse(catalog.active[0]?.name),
    last: z.string().parse(catalog.active.at(-1)?.name),
  });

  const schema = path.join(root, 'schema.ts');
  await fs.writeFile(
    schema,
    `export * from ${JSON.stringify(path.resolve('src/db/schema/index.ts'))};
import { pgTable, text } from ${JSON.stringify(path.resolve('../node_modules/drizzle-orm/pg-core/index.js'))};
export const squashFollowup = pgTable('squash_followup', { id: text('id').primaryKey() });
`,
  );
  await execFile(
    'pnpm',
    [
      'exec',
      'drizzle-kit',
      'generate',
      '--dialect',
      'postgresql',
      '--schema',
      schema,
      '--out',
      folder,
      '--name',
      'squash_followup',
    ],
    { timeout: 15_000 },
  );
  const after = await readMigrationCatalog(folder);
  expect(after.active).toHaveLength(2);
  expect(after.active[0]?.name).toBe(replacement);
  expect(after.active[1]?.sql).toContain('CREATE TABLE "squash_followup"');
  expect(after.active[1]?.sql).not.toContain('CREATE TABLE "card"');
});

test('rejects a preview if migration files have changed before confirmation', async t => {
  const { folder, names } = await migrationFixture(t);
  const catalog = await readMigrationCatalog(folder);
  await fs.appendFile(path.join(folder, z.string().parse(names[3]), 'migration.sql'), '\n-- changed after preview');
  const before = await readTree(folder);
  await expect(
    squashMigrations({
      folder,
      first: z.string().parse(names[0]),
      last: z.string().parse(names[1]),
      expectedRevision: catalog.revision,
    }),
  ).rejects.toThrow('changed since the preview');
  expect(await readTree(folder)).toEqual(before);
});

test('restores originals if publishing the staged directory fails', async t => {
  const { folder, names } = await migrationFixture(t);
  const before = await readTree(folder);
  const rename = fs.rename;
  const mock = vi.spyOn(fs, 'rename');
  t.onTestFinished(() => mock.mockRestore());
  mock.mockImplementationOnce((from, to) => rename(from, to));
  mock.mockRejectedValueOnce(new Error('publication failed'));
  mock.mockImplementation((from, to) => rename(from, to));
  await expect(
    squashMigrations({ folder, first: z.string().parse(names[0]), last: z.string().parse(names[1]) }),
  ).rejects.toThrow('publication failed');
  expect(await readTree(folder)).toEqual(before);
  expect((await readMigrationCatalog(folder)).active).toHaveLength(4);
});

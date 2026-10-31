import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { TestContext } from 'vitest';

import { parseMiseTools } from './mise-tools.ts';

async function fixture(t: TestContext, contents: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mise tools '));
  t.onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'mise.toml');
  await fs.writeFile(file, contents);

  return file;
}

describe('parseMiseTools', () => {
  it('reads the node, swift and pnpm entries from a mise.toml [tools] block', async t => {
    const contents = '[tools]\nnode = "26"\nswift = "6.4"\npnpm = "12.5.1"\n';

    const file = await fixture(t, contents);

    await expect(parseMiseTools(file)).resolves.toStrictEqual({ node: '26', swift: '6.4', pnpm: '12.5.1' });
  });

  it('omits entries that are not present', async t => {
    const contents = '[tools]\nnode = "26"\n';

    const file = await fixture(t, contents);

    await expect(parseMiseTools(file)).resolves.toStrictEqual({ node: '26' });
  });

  it('ignores tools this script does not check yet, without misparsing the rest', async t => {
    const contents = '[tools]\nnode = "26"\nswift = "6.4"\npnpm = "12.5.1"\nruby = "3.4"\n';

    const file = await fixture(t, contents);

    await expect(parseMiseTools(file)).resolves.toStrictEqual({ node: '26', swift: '6.4', pnpm: '12.5.1' });
  });

  it('parses values regardless of key ordering, comments or blank lines', async t => {
    const contents = '[tools]\n# tool versions\nswift = "6.4"\n\nnode = "26"\npnpm = "12.5.1"\n';

    const file = await fixture(t, contents);

    await expect(parseMiseTools(file)).resolves.toStrictEqual({ node: '26', swift: '6.4', pnpm: '12.5.1' });
  });

  it('reads Ansible and its controller tools from mise', async t => {
    const file = await fixture(
      t,
      '[tools]\npython = "3.14"\nuv = "0.13.6"\n"pypi:ansible-core" = { version = "2.21.5" }',
    );

    await expect(parseMiseTools(file)).resolves.toStrictEqual({
      python: '3.14',
      uv: '0.13.6',
      'pypi:ansible-core': '2.21.5',
    });
  });

  it('rejects a missing configuration file', async t => {
    const file = await fixture(t, '[tools]\n');
    await fs.rm(file);

    await expect(parseMiseTools(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

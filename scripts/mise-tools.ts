import fs from 'node:fs/promises';

import * as toml from 'smol-toml';
import z from 'zod';

const MiseToolsSchema = z.object({
  tools: z.object({
    node: z.string().optional(),
    swift: z.string().optional(),
    pnpm: z.string().optional(),
    terraform: z.string().optional(),
    uv: z.string().optional(),
    python: z.string().optional(),
    'pypi:ansible-core': z
      .object({ version: z.string() })
      .transform(tool => tool.version)
      .optional(),
  }),
});

export type MiseTools = z.infer<typeof MiseToolsSchema>['tools'];

export async function parseMiseTools(filePath: string): Promise<MiseTools> {
  const contents = await fs.readFile(filePath, 'utf8');

  return MiseToolsSchema.parse(toml.parse(contents)).tools;
}

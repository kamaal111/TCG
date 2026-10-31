import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import util from 'node:util';

import z from 'zod';

import { parseMiseTools } from './mise-tools.ts';

const ReleaseRepositorySchema = z.string().regex(/^ghcr\.io\/[a-z0-9._-]+\/[a-z0-9._-]+$/);

const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const ReleaseReferenceInputSchema = z.object({
  repository: ReleaseRepositorySchema,
  runtimeDigest: Sha256DigestSchema,
  migrationDigest: Sha256DigestSchema,
});

type ReleaseReferenceInput = z.infer<typeof ReleaseReferenceInputSchema>;

async function readReleaseBuild(directory: string, revision?: string) {
  const tools = await parseMiseTools(path.join(directory, 'mise.toml'));
  assert(tools.node && tools.pnpm, 'Node and pnpm must be configured in mise.toml.');

  const sha = z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .parse(
      revision ?? childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: directory }).trim(),
    );

  return { sha, node: tools.node, pnpm: tools.pnpm };
}

function releaseReferences(input: ReleaseReferenceInput) {
  return {
    runtime: `${input.repository}@${input.runtimeDigest}`,
    migration: `${input.repository}-migrations@${input.migrationDigest}`,
  };
}

interface ActionInput {
  file: string;
  revision?: string;
}

const ACTION_MAP = {
  repository: ({ file }: ActionInput): void => {
    console.log(ReleaseRepositorySchema.parse(file));
  },
  build: async ({ file, revision }: ActionInput): Promise<void> => {
    const build = await readReleaseBuild(file, revision);
    console.log(`${build.node}\n${build.pnpm}`);
  },
  digest: async ({ file }: ActionInput): Promise<void> => {
    const metadata = z
      .object({ 'containerimage.digest': Sha256DigestSchema })
      .parse(JSON.parse(await fs.readFile(file, 'utf8')));

    console.log(metadata['containerimage.digest']);
  },
  names: async (): Promise<void> => {
    const output = z.string().min(1).parse(process.env.GITHUB_OUTPUT);

    const source = z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/)
      .parse(process.env.GITHUB_REPOSITORY);

    const build = await readReleaseBuild('.');
    await fs.appendFile(
      output,
      `repository=ghcr.io/${source.toLowerCase()}-server\nsha=${build.sha}\nnode=${build.node}\npnpm=${build.pnpm}\n`,
    );
  },
  refs: async (): Promise<void> => {
    const output = z.string().min(1).parse(process.env.GITHUB_OUTPUT);

    const refs = releaseReferences(
      ReleaseReferenceInputSchema.parse({
        repository: process.env.REPOSITORY,
        runtimeDigest: process.env.RUNTIME_DIGEST,
        migrationDigest: process.env.MIGRATION_DIGEST,
      }),
    );

    await fs.appendFile(output, `runtime=${refs.runtime}\nmigration=${refs.migration}\n`);
  },
};

function isAction(action: string | undefined): action is keyof typeof ACTION_MAP {
  return action !== undefined && Object.hasOwn(ACTION_MAP, action);
}

async function main(): Promise<void> {
  const { positionals } = util.parseArgs({ allowPositionals: true });
  const [action, file = '.', revision] = positionals;

  if (!isAction(action)) {
    console.error('Expected repository, build, digest, names, or refs.');
    process.exitCode = 64;

    return;
  }

  await ACTION_MAP[action]({ file, revision });
}

if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

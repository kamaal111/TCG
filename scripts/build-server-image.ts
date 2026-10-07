import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import z from 'zod';

import { parseMiseTools } from './check-versions-in-sync.ts';

const repoRoot = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

const DockerConfigSchema = z.looseObject({
  credsStore: z.string().optional(),
  credHelpers: z.record(z.string(), z.string()).optional(),
});

async function readDockerConfig(directory: string): Promise<z.infer<typeof DockerConfigSchema> | undefined> {
  let contents: string;

  try {
    contents = await fs.readFile(path.join(directory, 'config.json'), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }

  try {
    return DockerConfigSchema.parse(JSON.parse(contents));
  } catch {
    throw new Error('Invalid Docker configuration: expected a JSON object with valid credential-helper settings.');
  }
}

function isEditorHelper(helper: string | undefined): boolean {
  return helper?.startsWith('dev-containers-') ?? false;
}

async function buildServerImage(): Promise<number> {
  const tools = parseMiseTools(await fs.readFile(path.join(repoRoot, 'mise.toml'), 'utf8'));

  if (tools.node === undefined || tools.pnpm === undefined) {
    throw new Error('Building the server image requires Node and pnpm versions in mise.toml.');
  }

  let temporaryConfig: string | undefined;
  let env = process.env;

  try {
    if (process.env.TCG_DEVCONTAINER) {
      const directory = path.resolve(process.env.DOCKER_CONFIG || path.join(os.homedir(), '.docker'));
      const config = await readDockerConfig(directory);

      if (
        config &&
        (isEditorHelper(config.credsStore) || Object.values(config.credHelpers ?? {}).some(isEditorHelper))
      ) {
        // VS Code's helpers depend on editor IPC unavailable to standalone devcontainer exec sessions.
        if (isEditorHelper(config.credsStore)) {
          delete config.credsStore;
        }

        if (config.credHelpers) {
          config.credHelpers = Object.fromEntries(
            Object.entries(config.credHelpers).filter(([, helper]) => !isEditorHelper(helper)),
          );
        }

        temporaryConfig = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-server-docker-'));
        await fs.writeFile(path.join(temporaryConfig, 'config.json'), JSON.stringify(config), { mode: 0o600 });
        const directoryEntries = await fs.readdir(directory);

        await Promise.all(
          directoryEntries.map(async entry => {
            if (entry !== 'config.json') {
              assert(temporaryConfig, 'Expecting temporary config to be present at this point');

              await fs.symlink(path.join(directory, entry), path.join(temporaryConfig, entry));
            }
          }),
        );

        env = { ...process.env, DOCKER_CONFIG: temporaryConfig };
      }
    }

    const result = childProcess.spawnSync(
      'docker',
      [
        'build',
        '--build-arg',
        `NODE_VERSION=${tools.node}`,
        '--build-arg',
        `PNPM_VERSION=${tools.pnpm}`,
        '--tag',
        'tcg-server:local',
        '.',
      ],
      { cwd: repoRoot, stdio: 'inherit', env },
    );

    if (result.error) {
      throw result.error;
    }

    return result.status ?? 1;
  } finally {
    if (temporaryConfig) {
      await fs.rm(temporaryConfig, { recursive: true, force: true });
    }
  }
}

process.exitCode = await buildServerImage();

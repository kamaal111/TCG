import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

import { parseMiseTools } from './check-versions-in-sync.ts';

const repoRoot = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

const tools = parseMiseTools(await fs.readFile(path.join(repoRoot, 'mise.toml'), 'utf8'));

if (tools.node === undefined || tools.pnpm === undefined) {
  throw new Error('Building the server image requires Node and pnpm versions in mise.toml.');
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
  { cwd: repoRoot, stdio: 'inherit' },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

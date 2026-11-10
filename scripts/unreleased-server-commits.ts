import childProcess from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import util from 'node:util';

import { gitFetch, gitRevision } from './git.ts';
import { homePath } from './infra/config.ts';
import { InfraFailure } from './infra/errors.ts';
import { commitSummary, selectRelease } from './release/commits.ts';
import { releaseConnection } from './release/connection.ts';
import { HostSchema, ShaSchema } from './release/contracts.ts';

const execute = util.promisify(childProcess.execFile);

async function main(): Promise<void> {
  let options;

  try {
    options = util.parseArgs({
      options: { help: { type: 'boolean' }, 'config-dir': { type: 'string' } },
      allowPositionals: true,
    });
  } catch {
    throw new InfraFailure('Invalid arguments. Use just unreleased-server-commits --help.', 64);
  }

  if (options.values.help) {
    console.log(
      'Usage: just unreleased-server-commits [REVISION] [--config-dir DIRECTORY]\n\nShow all commits absent from the deployed server, newest first.\nDefault revision: freshly fetched origin/main. Settings: $HOME/.config/tcg.\nRequires Git, Tailscale and configured SSH access. Does not deploy.',
    );

    return;
  }

  if (options.positionals.length > 1 || options.values['config-dir'] === '') {
    throw new InfraFailure('Supply at most one revision and a nonempty settings directory.', 64);
  }

  const root = url.fileURLToPath(new URL('../', import.meta.url));
  const configDirectory = homePath(options.values['config-dir'] ?? path.join(os.homedir(), '.config/tcg'));
  const { environment, settings } = await releaseConnection(root, configDirectory);

  const command = async (program: string, args: string[]): Promise<string> => {
    const result = await execute(program, args, { cwd: root, env: environment, maxBuffer: 64 * 1024 * 1024 });

    return result.stdout.trim();
  };

  await gitFetch(command);
  const main = ShaSchema.parse(await gitRevision(command, 'origin/main'));
  const selected = await selectRelease(command, options.positionals[0] ?? 'origin/main', main);

  const host = HostSchema.parse(
    JSON.parse(await command('bash', [path.join(root, 'scripts/deployment-ssh.sh'), 'status'])),
  );

  if (host.repository !== settings.TCG_IMAGE_REPOSITORY) {
    throw new InfraFailure('The host registry differs from release.env. Check setup before continuing.');
  }

  console.log(
    `Target: ${host.hostname || 'private server'}\nRunning: ${host.revision ?? 'no release'}\nRelease: ${selected}`,
  );
  console.log(await commitSummary(command, host.revision, selected));
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof InfraFailure
      ? error.message
      : 'Commit comparison unavailable. Check Git, Tailscale, SSH and the host status protocol.',
  );
  process.exitCode = error instanceof InfraFailure ? error.exitCode : 1;
}

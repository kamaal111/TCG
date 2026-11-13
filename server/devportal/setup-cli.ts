import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { Conflict } from '@tcg/http/exceptions';

import { manageAgent } from './agent-service.ts';
import { parseSetupArguments, SETUP_USAGE } from './cli.ts';
import { portalCommands } from './commands.ts';
import { setupDevportal } from './setup.ts';
import { homePath } from '../../scripts/infra/config.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';

async function main(): Promise<void> {
  const options = parseSetupArguments();

  if (options.help) {
    console.log(
      `${SETUP_USAGE}\n\nGuided setup on the release Mac: checks prerequisites, reuses release credentials,\ncollects allowed Tailscale users, installs startup and enables private HTTPS.\nDefault settings: $HOME/.config/tcg (or TCG_CONFIG_DIRECTORY).\nRequires macOS, installed project dependencies, Docker and connected Tailscale.\nNo release is started. Existing Tailscale services are preserved.`,
    );

    return;
  }

  if (process.platform !== 'darwin' || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new InfraFailure(
      'Run just setup-devportal in an interactive terminal on the release Mac. Use --help for usage.',
      64,
    );
  }

  const root = url.fileURLToPath(new URL('../../', import.meta.url));

  const configDirectory = path.resolve(
    homePath(options.configDirectory ?? process.env.TCG_CONFIG_DIRECTORY ?? path.join(os.homedir(), '.config/tcg')),
  );

  let tailscale = 'tailscale';

  if (childProcess.spawnSync('which', [tailscale], { stdio: 'ignore' }).status !== 0) {
    tailscale = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

    try {
      await fs.access(tailscale, fs.constants.X_OK);
    } catch {
      throw new InfraFailure('Install and open Tailscale on this Mac, sign in, then rerun just setup-devportal.');
    }
  }

  const { terminalPrompts } = await import('../../scripts/infra/prompts.ts');
  await setupDevportal({
    root,
    configDirectory,
    tailscale,
    prompts: terminalPrompts,
    installAgent: directory => manageAgent('install', directory),
    commands: portalCommands(root, 'just setup-devportal'),
  });
}

try {
  await main();
} catch (error) {
  if (error instanceof Conflict) {
    console.error(`${error.message} Stop the release before rerunning setup.`);
  } else if (error instanceof InfraFailure) {
    console.error(error.message);
  } else {
    console.error(
      'Setup could not finish. Check settings and prerequisites, then rerun just setup-devportal. Completed settings remain saved.',
    );
  }

  process.exitCode = error instanceof InfraFailure ? error.exitCode : 1;
}

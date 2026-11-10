import timers from 'node:timers/promises';

import { Conflict } from '@tcg/http/exceptions';
import { SERVER_SHUTDOWN_TIMEOUT_MS } from '@tcg/http/node-server-lifecycle';
import z from 'zod';

import type { PortalCommands } from './commands.ts';
import { readPortalSettings } from './config.ts';
import { gitCurrentBranch, gitFastForward, gitFetch, gitRevision, gitStatus } from '../../scripts/git.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';
import { selectRelease } from '../../scripts/release/commits.ts';
import { ShaSchema } from '../../scripts/release/contracts.ts';
import { acquireLocalLease, acquireReleaseLock } from '../../scripts/release/lock.ts';

interface InstallOptions {
  configDirectory: string;
  installed: boolean;
  commands: PortalCommands;
  stop: () => Promise<void>;
}

async function waitForStoppedService(directory: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + SERVER_SHUTDOWN_TIMEOUT_MS + 1_000;

  while (true) {
    try {
      return await acquireLocalLease(directory, 'devportal');
    } catch (error) {
      if (!(error instanceof Conflict) || Date.now() >= deadline) {
        throw new InfraFailure(
          'The existing Devportal process has not stopped. Nothing was updated. Rerun just install-devportal-agent when it has stopped.',
        );
      }

      await timers.setTimeout(100);
    }
  }
}

export async function installDevportalAgent(options: InstallOptions): Promise<void> {
  const { configDirectory, installed, commands } = options;
  let configured = true;

  try {
    await readPortalSettings(configDirectory);
  } catch (error) {
    if (!z.object({ code: z.literal('ENOENT') }).safeParse(error).success) {
      throw new InfraFailure(
        'Existing devportal.json is invalid or unreadable. It has been preserved; repair it before rerunning just install-devportal-agent.',
      );
    }

    configured = false;
  }

  if (!installed || !configured) {
    commands.run('just', ['setup-devportal', '--config-dir', configDirectory]);

    return;
  }

  const unlock = await acquireReleaseLock(configDirectory);

  try {
    if (gitCurrentBranch(commands.read).trim() !== 'main') {
      throw new InfraFailure(
        'Run just install-devportal-agent from the persistent main checkout used by this Mac. The service was left running.',
      );
    }

    if (gitStatus(commands.read).trim()) {
      throw new InfraFailure(
        'This checkout has local changes. Commit or move them before rerunning just install-devportal-agent. The service was left running.',
      );
    }

    gitFetch(commands.run, { noTags: true });
    const target = ShaSchema.parse(gitRevision(commands.read, 'origin/main').trim());
    await requireFastForward(commands, target);
    await updateCheckout(options, target);
  } finally {
    await unlock();
  }
}

async function requireFastForward(commands: PortalCommands, target: string): Promise<void> {
  try {
    await selectRelease(async (program, args) => commands.read(program, args).trim(), 'HEAD', target);
  } catch {
    throw new InfraFailure(
      'Local main cannot fast-forward to merged origin/main. Keep local commits on another branch before rerunning just install-devportal-agent. The service was left running.',
    );
  }
}

async function updateCheckout({ configDirectory, commands, stop }: InstallOptions, target: string): Promise<void> {
  await stop();
  const releaseServiceLease = await waitForStoppedService(configDirectory);

  try {
    if (gitCurrentBranch(commands.read).trim() !== 'main' || gitStatus(commands.read).trim()) {
      throw new InfraFailure(
        'The checkout changed during the update. Local work was preserved. Rerun just install-devportal-agent once main is clean.',
      );
    }

    gitFastForward(commands.run, target);
    commands.run('mise', ['install']);
    commands.run('mise', ['exec', '--', 'just', 'install-js-modules', '--frozen-lockfile']);
  } finally {
    await releaseServiceLease();
  }

  // Use the fetched installer and refreshed runtime instead of modules cached before the update.
  commands.run('mise', [
    'exec',
    '--',
    'node',
    'devportal/src/agent-service-cli.ts',
    'install',
    '--config-dir',
    configDirectory,
  ]);
  console.log(
    `Updated Mintomo Devportal to ${target.slice(0, 12)}. Settings, Tailscale access and release history were preserved.`,
  );
}

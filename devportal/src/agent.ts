import url from 'node:url';

import { Conflict } from '@tcg/http/exceptions';

import { manageAgent, readAgentInstallation } from './agent-service.ts';
import { AGENT_USAGE, parseAgentArguments } from './cli.ts';
import { portalCommands } from './commands.ts';
import { installDevportalAgent } from './install.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';
import { acquireReleaseLock } from '../../scripts/release/lock.ts';

async function main(): Promise<void> {
  const options = parseAgentArguments();

  if (options.help) {
    console.log(AGENT_USAGE);

    return;
  }

  if (process.platform !== 'darwin') {
    throw new InfraFailure('The Devportal LaunchAgent requires macOS.');
  }

  const { action } = options;
  const { installed, configDirectory } = await readAgentInstallation(options.configDirectory);

  if (action === 'install') {
    await installDevportalAgent({
      installed,
      configDirectory,
      commands: portalCommands(url.fileURLToPath(new URL('../../', import.meta.url)), 'just install-devportal-agent'),
      stop: () => manageAgent('stop', configDirectory),
    });
  } else if (action === 'uninstall') {
    const unlock = await acquireReleaseLock(configDirectory);

    try {
      await manageAgent(action, configDirectory);
    } finally {
      await unlock();
    }
  } else {
    await manageAgent(action, configDirectory);
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof Conflict) {
    console.error('A release is running. Let it finish before changing Devportal. Nothing was updated.');
  } else if (error instanceof InfraFailure) {
    console.error(error.message);
  } else {
    console.error(
      'Devportal could not be updated. Follow the tool output above, then rerun just install-devportal-agent. Settings and release history were preserved.',
    );
  }

  process.exitCode = error instanceof InfraFailure ? error.exitCode : 1;
}

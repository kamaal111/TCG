import { manageAgent } from './agent-service.ts';
import { AGENT_USAGE, parseAgentArguments } from './cli.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';

try {
  const options = parseAgentArguments();

  if (options.help) {
    console.log(AGENT_USAGE);
  } else {
    await manageAgent(options.action, options.configDirectory);
  }
} catch (error) {
  console.error(
    error instanceof InfraFailure
      ? error.message
      : 'The login service could not be installed. Rerun just install-devportal-agent; private settings and history were preserved.',
  );
  process.exitCode = error instanceof InfraFailure ? error.exitCode : 1;
}

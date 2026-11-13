import util from 'node:util';

import z from 'zod';

import { homePath } from '../../scripts/infra/config.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';

export const AGENT_USAGE =
  'Usage: just install-devportal-agent [--config-dir DIRECTORY] [--help]\n       just devportal-agent-status [--help]\n       just uninstall-devportal-agent [--help]';

export const SETUP_USAGE = 'Usage: just setup-devportal [--config-dir DIRECTORY] [--help]';

const OPTIONS = { help: { type: 'boolean' }, 'config-dir': { type: 'string' } } as const;

const OptionsSchema = z.strictObject({
  help: z.boolean().default(false),
  'config-dir': z
    .string()
    .refine(value => value.trim().length > 0)
    .transform(homePath)
    .optional(),
});

const ActionSchema = z.tuple([z.enum(['install', 'uninstall', 'status', 'preview'])]);

function parseArguments(allowPositionals: boolean, usage: string) {
  let parsed;

  try {
    parsed = util.parseArgs({ options: OPTIONS, strict: true, allowPositionals });
  } catch {
    throw new InfraFailure(`Invalid arguments. ${usage}`, 64);
  }

  const options = OptionsSchema.safeParse(parsed.values);

  if (!options.success) {
    throw new InfraFailure(`Invalid options. ${usage}`, 64);
  }

  return { options: options.data, positionals: parsed.positionals };
}

export function parseAgentArguments() {
  const { options, positionals } = parseArguments(true, AGENT_USAGE);

  if (options.help) {
    return { help: true as const };
  }

  const action = ActionSchema.safeParse(positionals);

  if (!action.success) {
    throw new InfraFailure(`Expected one agent action: install, uninstall, status, or preview. ${AGENT_USAGE}`, 64);
  }

  return { help: false as const, action: action.data[0], configDirectory: options['config-dir'] };
}

export function parseSetupArguments() {
  const { options } = parseArguments(false, SETUP_USAGE);

  return { help: options.help, configDirectory: options['config-dir'] };
}

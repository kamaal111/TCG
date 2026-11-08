import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import util from 'node:util';

import { ConfigStore, homePath } from './infra/config.ts';
import { credentials } from './infra/credentials.ts';
import { InfraFailure } from './infra/errors.ts';
import { runRotation, runSetup } from './infra/wizard.ts';

const repositoryRoot = url.fileURLToPath(new URL('../', import.meta.url));

async function main(): Promise<void> {
  let options: ReturnType<
    typeof util.parseArgs<{
      options: { help: { type: 'boolean' }; 'config-dir': { type: 'string' } };
      allowPositionals: true;
    }>
  >;

  try {
    options = util.parseArgs({
      options: { help: { type: 'boolean' }, 'config-dir': { type: 'string' } },
      allowPositionals: true,
    });
  } catch {
    throw new InfraFailure(
      'Usage: just setup-infra [--config-dir DIRECTORY] or just rotate-keys [--config-dir DIRECTORY].',
      64,
    );
  }

  if (options.values.help) {
    console.log(
      'Usage: just setup-infra [--config-dir DIRECTORY]\n       just rotate-keys [--config-dir DIRECTORY]\n\nInteractive local settings only. No infrastructure is applied and no credentials are activated.\nDefault settings directory: $HOME/.config/tcg\nPrerequisites: mise install, just install-js-modules, Git, and just.\nUse --help without an interactive terminal.',
    );

    return;
  }

  const [mode, ...extra] = options.positionals;

  if ((mode !== 'setup' && mode !== 'rotate-keys') || extra.length || options.values['config-dir'] === '') {
    throw new InfraFailure('Expected setup or rotate-keys and an optional --config-dir DIRECTORY.', 64);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new InfraFailure('Run this wizard in an interactive terminal. Use --help for usage.', 64);
  }

  const configDirectory = homePath(options.values['config-dir'] ?? path.join(os.homedir(), '.config/tcg'));

  const store = new ConfigStore({ repositoryRoot, configDirectory });
  const { terminalPrompts } = await import('./infra/prompts.ts');
  const document = await store.readEnvironment('infrastructure');
  const release = await store.readEnvironment('release');

  const managedKeys = new Set([
    ...credentials.flatMap(credential => credential.fields.map(field => field.key)),
    ...Object.keys(document.values),
    ...Object.keys(release.values),
  ]);

  const conflicts = [...managedKeys].filter(
    key =>
      process.env[key] !== undefined &&
      process.env[key] !== document.values[key] &&
      process.env[key] !== release.values[key],
  );

  if (conflicts.length) {
    terminalPrompts.note(
      `Exported variables can override saved settings when you run infrastructure commands. This wizard reads the chosen files.\nBefore using the saved settings, run:\nunset ${conflicts.join(' ')}`,
    );
  }

  const wizard = { store, prompts: terminalPrompts, repositoryRoot };

  if (mode === 'setup') {
    await runSetup(wizard);
  } else {
    await runRotation(wizard);
  }
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof InfraFailure
      ? error.message
      : 'The wizard could not complete. Check private file access and prerequisites (mise install and just install-js-modules). Saved settings were preserved.',
  );
  process.exitCode = error instanceof InfraFailure ? error.exitCode : 1;
}

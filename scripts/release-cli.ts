import childProcess from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import util from 'node:util';

import { homePath } from './infra/config.ts';
import { InfraFailure } from './infra/errors.ts';
import { terminalPrompts } from './infra/prompts.ts';
import { releaseFromTerminal } from './release/runtime.ts';

async function main(): Promise<void> {
  const options = util.parseArgs({
    options: { help: { type: 'boolean' }, 'config-dir': { type: 'string' }, 'non-interactive': { type: 'boolean' } },
    allowPositionals: true,
  });

  if (options.values.help) {
    console.log(
      'Usage: just release-server [REVISION] [--config-dir DIRECTORY]\n\nGuided release of code merged into main. Default revision: origin/main.\nSettings: $HOME/.config/tcg. Prompts before infrastructure apply, migrations and deployment.\nRerun with the same revision after a failure to reuse published images and recheck live state.\nAutomation: just release-server --non-interactive [REVISION] [private|public] [true|false]\nThe legacy Bash entrypoint and GitHub Actions remain available.',
    );

    return;
  }

  if (options.values['config-dir'] === '') {
    throw new InfraFailure('The settings directory must not be empty.', 64);
  }

  const configDirectory = homePath(options.values['config-dir'] ?? path.join(os.homedir(), '.config/tcg'));
  const root = url.fileURLToPath(new URL('../', import.meta.url));

  if (options.values['non-interactive']) {
    const environment = { ...process.env };

    if (options.values['config-dir']) {
      environment.TCG_RELEASE_ENV_FILE = path.join(configDirectory, 'release.env');
    }

    const result = childProcess.spawnSync('bash', ['scripts/release-server.sh', ...options.positionals], {
      cwd: root,
      stdio: 'inherit',
      env: environment,
    });

    process.exitCode = result.status ?? 1;

    return;
  }

  if (options.positionals.length > 1 || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new InfraFailure(
      'Run just release-server [REVISION] in an interactive terminal. Use --help for automation options.',
      64,
    );
  }

  await releaseFromTerminal({
    root,
    configDirectory,
    revision: options.positionals[0] ?? 'origin/main',
    prompts: terminalPrompts,
  });
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof InfraFailure
      ? error.message
      : 'Release stopped. Check prerequisites and the private release log. No automatic database rollback was attempted.',
  );
  process.exitCode = error instanceof InfraFailure ? error.exitCode : 1;
}

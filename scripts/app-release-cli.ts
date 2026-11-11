import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import util from 'node:util';

import { PlatformSchema, readAppSettings } from './app-release/config.ts';
import { releaseAppFromTerminal } from './app-release/runtime.ts';
import { setupAppRelease } from './app-release/setup.ts';
import { homePath } from './infra/config.ts';
import { InfraFailure } from './infra/errors.ts';
import { terminalPrompts } from './infra/prompts.ts';

async function main() {
  const args = (() => {
    try {
      return util.parseArgs({
        options: { help: { type: 'boolean' }, edit: { type: 'boolean' }, 'config-dir': { type: 'string' } },
        allowPositionals: true,
      });
    } catch {
      throw new InfraFailure('Invalid app release arguments. Use --help for usage.', 64);
    }
  })();

  if (args.values.help) {
    console.log(
      'Usage: just setup-app-release [--edit] [--config-dir DIRECTORY]\n       just release-ios [REVISION] [--config-dir DIRECTORY]\n       just release-macos [REVISION] [--config-dir DIRECTORY]\n\nDefault revision: origin/main; revisions must be merged into main. Settings: $HOME/.config/tcg.\nUses the Xcode account on this Mac, automatic signing and automatic upload build numbers.\nChecks, archives and uploads to App Store Connect with explicit approvals. Does not submit for review.',
    );

    return;
  }

  const [action, revision = 'origin/main', ...extra] = args.positionals;

  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    extra.length ||
    !action ||
    (action !== 'setup' && !PlatformSchema.safeParse(action).success) ||
    (action === 'setup' && args.positionals.length > 1) ||
    args.values['config-dir'] === ''
  ) {
    throw new InfraFailure(
      'Use an interactive terminal: just setup-app-release, just release-ios [REVISION], or just release-macos [REVISION]. Use --help for details.',
      64,
    );
  }

  const root = url.fileURLToPath(new URL('../', import.meta.url));

  const directory =
    args.values['config-dir'] ?? process.env.TCG_CONFIG_DIRECTORY ?? path.join(os.homedir(), '.config/tcg');

  if (!directory.trim()) {
    throw new InfraFailure('The settings directory must not be empty.', 64);
  }

  const configDirectory = homePath(directory);

  if (args.values.edit && action !== 'setup') {
    throw new InfraFailure('--edit is only supported by just setup-app-release.', 64);
  }

  if (action === 'setup') {
    await setupAppRelease({ root, directory: configDirectory, prompts: terminalPrompts, edit: args.values.edit });

    return;
  }

  try {
    await readAppSettings(configDirectory);
  } catch {
    await setupAppRelease({ root, directory: configDirectory, prompts: terminalPrompts });
  }

  const cancellation = new AbortController();
  const stop = () => cancellation.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    await releaseAppFromTerminal({
      root,
      configDirectory,
      platform: PlatformSchema.parse(action),
      revision,
      prompts: terminalPrompts,
      signal: cancellation.signal,
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

process.umask(0o077);

try {
  await main();
} catch (error) {
  console.error(
    error instanceof InfraFailure
      ? error.message
      : 'App release stopped. Check arguments, Xcode setup and the private app release log.',
  );
  process.exitCode = error instanceof InfraFailure ? error.exitCode : 1;
}

import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import util from 'node:util';

import { PlatformSchema, readAppSettings } from './app-release/config.ts';
import { followAppReleaseLog } from './app-release/logs.ts';
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
      'Usage: just setup-app-release [--edit] [--config-dir DIRECTORY]\n       just release-ios [REVISION] [--config-dir DIRECTORY]\n       just release-macos [REVISION] [--config-dir DIRECTORY]\n       just logs-app-release [ios|macos] [--config-dir DIRECTORY]\n\nDefault revision: origin/main; revisions must be merged into main. Settings: $HOME/.config/tcg.\nUses the Xcode account on this Mac, automatic signing and automatic upload build numbers.\nArchives and uploads previously verified source to App Store Connect with explicit approvals. No test or quality gate runs during release. Does not submit for review.\nLog watching uses tail -n 100 -F on the latest session; Ctrl-C stops watching.',
    );

    return;
  }

  const [action, revision = 'origin/main', ...extra] = args.positionals;

  if (
    (action !== 'logs' && (!process.stdin.isTTY || !process.stdout.isTTY)) ||
    extra.length ||
    !action ||
    (action !== 'setup' && action !== 'logs' && !PlatformSchema.safeParse(action).success) ||
    (action === 'logs' && args.positionals.length > 1 && !PlatformSchema.safeParse(args.positionals[1]).success) ||
    (action === 'setup' && args.positionals.length > 1) ||
    args.values['config-dir'] === ''
  ) {
    throw new InfraFailure(
      'Use an interactive terminal: just setup-app-release, just release-ios [REVISION], or just release-macos [REVISION]. To watch logs: just logs-app-release [ios|macos]. Use --help for details.',
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

  if (action === 'logs') {
    await followAppReleaseLog(
      configDirectory,
      args.positionals[1] ? PlatformSchema.parse(args.positionals[1]) : undefined,
    );

    return;
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
      output: chunk => {
        process.stdout.write(chunk);
      },
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
  console.error(error instanceof Error ? error.message : util.inspect(error, { depth: 3, maxStringLength: 4000 }));
  process.exitCode = error instanceof InfraFailure ? error.exitCode : 1;
}

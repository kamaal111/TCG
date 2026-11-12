import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import util from 'node:util';

import { PlatformSchema, readAppSettings } from './app-release/config.ts';
import { setupAppRelease, setupLocalSigning } from './app-release/setup.ts';
import { homePath } from './infra/config.ts';
import { InfraFailure } from './infra/errors.ts';
import { terminalPrompts } from './infra/prompts.ts';

try {
  const args = util.parseArgs({
    options: {
      help: { type: 'boolean' },
      edit: { type: 'boolean' },
      platform: { type: 'string', default: 'ios' },
      'config-dir': { type: 'string' },
    },
    allowPositionals: true,
  });

  if (args.values.help) {
    console.log(
      'Usage: just setup-app-release [--platform ios|macos] [--edit] [--config-dir DIRECTORY]\nSettings: $HOME/.config/tcg. Release recipes use shell scripts and default to origin/main.',
    );
  } else {
    if (args.positionals.length !== 1 || args.positionals[0] !== 'setup') {
      throw new InfraFailure(
        'Use just setup-app-release. Releases run through just release-ios or just release-macos.',
        64,
      );
    }

    const directory =
      args.values['config-dir'] ?? process.env.TCG_CONFIG_DIRECTORY ?? path.join(os.homedir(), '.config/tcg');

    if (!directory.trim()) {
      throw new InfraFailure('The settings directory must not be empty.', 64);
    }

    const platform = PlatformSchema.parse(args.values.platform);

    await setupAppRelease({
      root: url.fileURLToPath(new URL('../', import.meta.url)),
      directory: homePath(directory),
      prompts: terminalPrompts,
      edit: args.values.edit,
    });
    const settings = await readAppSettings(homePath(directory));
    await setupLocalSigning({
      directory: homePath(directory),
      platform,
      team: settings.teamID,
      prompts: terminalPrompts,
    });
  }
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : util.inspect(cause));
  process.exitCode = cause instanceof InfraFailure ? cause.exitCode : 1;
}

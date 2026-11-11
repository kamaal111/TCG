import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';

import { AppSettingsSchema, readAppSettings, saveAppSettings } from './config.ts';
import { ConfigStore } from '../infra/config.ts';
import { InfraFailure } from '../infra/errors.ts';
import type { Prompts } from '../infra/prompts.ts';

interface SetupOptions {
  root: string;
  directory: string;
  prompts: Prompts;
  edit?: boolean;
}

const execute = util.promisify(childProcess.execFile);

async function configurationCheckouts(root: string): Promise<string[]> {
  try {
    const result = await execute('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: root, timeout: 10000 });

    const primary = result.stdout
      .split('\0')
      .find(field => field.startsWith('worktree '))
      ?.slice('worktree '.length);

    return primary && primary !== root ? [root, primary] : [root];
  } catch {
    // A source checkout outside Git can still use its own configuration.
    return [root];
  }
}

async function configuredHostname(root: string, directory: string, saved?: string): Promise<string | undefined> {
  if (saved) {
    return saved;
  }

  const checkouts = await configurationCheckouts(root);

  for (const checkout of checkouts) {
    const store = new ConfigStore({ repositoryRoot: checkout, configDirectory: directory });
    const terraform = await store.readTerraform();
    const infrastructure = AppSettingsSchema.shape.apiHost.safeParse(terraform.values?.configuration.api_hostname);

    if (infrastructure.success) {
      return infrastructure.data;
    }
  }

  for (const checkout of checkouts) {
    const remote = await fs
      .readFile(path.join(checkout, 'app/Configuration/Remote.local.xcconfig'), 'utf8')
      .catch(() => '');

    const local = AppSettingsSchema.shape.apiHost.safeParse(/^TCG_API_HOST\s*=\s*(\S+)/m.exec(remote)?.[1]);

    if (local.success) {
      return local.data;
    }
  }

  return undefined;
}

export async function setupAppRelease({ root, directory, prompts, edit = false }: SetupOptions): Promise<void> {
  const saved = await readAppSettings(directory).catch(() => undefined);
  const project = await fs.readFile(path.join(root, 'app/Configuration/App.xcconfig'), 'utf8');
  const knownHost = await configuredHostname(root, directory, saved?.apiHost);

  const knownTeam = AppSettingsSchema.shape.teamID.safeParse(
    saved?.teamID ?? /^DEVELOPMENT_TEAM\s*=\s*(\w+)/m.exec(project)?.[1],
  );

  prompts.note(
    'Sign into Xcode Settings → Accounts with your Apple Developer account. The account needs access to signing certificates and App Store Connect uploads for your team. Keep the release user logged in, the Mac awake and Keychain unlocked. Accept Apple agreements and create the app record with iOS and macOS platforms before uploading. No Apple password is saved here.',
    'App release setup',
  );

  const teamID =
    !edit && knownTeam.success
      ? knownTeam.data
      : await prompts.text({
          message: 'Apple Developer team ID',
          initialValue: knownTeam.success ? knownTeam.data : undefined,
          validate: value => {
            return AppSettingsSchema.shape.teamID.safeParse(value).success
              ? undefined
              : 'Enter the ten-character team ID from your developer account.';
          },
        });

  const apiHost =
    !edit && knownHost
      ? knownHost
      : await prompts.text({
          message: 'Production API hostname (without https:// or a path)',
          initialValue: knownHost,
          validate: value => {
            return AppSettingsSchema.shape.apiHost.safeParse(value).success
              ? undefined
              : 'Enter a production hostname, such as api.mintomo.com.';
          },
        });

  prompts.note(
    `Team: ${teamID}\nAPI: https://${apiHost}\nAuthentication: this Mac’s Xcode account\nDestination: App Store Connect\nUse just setup-app-release --edit to change reused values.`,
  );

  if (!(await prompts.confirm('Save these app release settings?', true))) {
    throw new InfraFailure('Setup cancelled. Previous settings were preserved.', 130);
  }

  await saveAppSettings(directory, { version: 1, teamID, apiHost });
}

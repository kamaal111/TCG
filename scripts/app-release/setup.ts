import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';

import {
  AppAuthenticationSchema,
  AppSettingsSchema,
  readAppAuthentication,
  readAppSettings,
  saveAppSettings,
  saveAppAuthentication,
} from './config.ts';
import { ConfigStore, homePath } from '../infra/config.ts';
import type { Prompts } from '../infra/prompts.ts';

interface SetupOptions {
  root: string;
  directory: string;
  prompts: Prompts;
  edit?: boolean;
  apiKey?: boolean;
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

export async function setupAppRelease({
  root,
  directory,
  prompts,
  edit = false,
  apiKey = false,
}: SetupOptions): Promise<void> {
  const saved = await readAppSettings(directory).catch(() => undefined);
  const project = await fs.readFile(path.join(root, 'app/Configuration/App.xcconfig'), 'utf8');
  const knownHost = await configuredHostname(root, directory, saved?.apiHost);

  const knownTeam = AppSettingsSchema.shape.teamID.safeParse(
    saved?.teamID ?? /^DEVELOPMENT_TEAM\s*=\s*(\w+)/m.exec(project)?.[1],
  );

  prompts.note(
    'Automatic signing and uploads use the Apple Developer account signed into Xcode Settings → Accounts. Keep the signing Keychain unlocked. API keys are optional; use just setup-app-release --api-key only to configure one. No Apple password is requested or saved.',
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

  if (apiKey) {
    await configureAPIKey(directory, prompts, edit);
  }

  await saveAppSettings(directory, { version: 1, teamID, apiHost });
  prompts.note(
    `Saved release settings.\nTeam: ${teamID}\nAPI: https://${apiHost}\nAuthentication: Xcode account, or optional API key if configured\nDestination: App Store Connect`,
  );
}

async function configureAPIKey(directory: string, prompts: Prompts, edit: boolean): Promise<void> {
  const savedAuthentication = await readAppAuthentication(directory).catch(() => undefined);

  const keyPath =
    !edit && savedAuthentication
      ? savedAuthentication.keyPath
      : homePath(
          await prompts.text({
            message: 'Path to the App Store Connect API private key (.p8)',
            initialValue: savedAuthentication?.keyPath,
          }),
        );

  await fs.access(keyPath, fs.constants.R_OK);
  const keyFromName = /AuthKey_([A-Z0-9]{10})\.p8$/.exec(keyPath)?.[1];

  const keyID =
    !edit && savedAuthentication
      ? savedAuthentication.keyID
      : (keyFromName ??
        (await prompts.text({ message: 'App Store Connect Key ID', initialValue: savedAuthentication?.keyID })));

  const issuerID =
    !edit && savedAuthentication
      ? savedAuthentication.issuerID
      : await prompts.text({
          message: 'App Store Connect Issuer ID',
          initialValue: savedAuthentication?.issuerID,
          validate: value => {
            return AppAuthenticationSchema.shape.issuerID.safeParse(value).success
              ? undefined
              : 'Enter the Issuer ID shown above the team API keys.';
          },
        });

  const authentication = AppAuthenticationSchema.parse({ keyPath, keyID, issuerID });
  await saveAppAuthentication(directory, authentication);
}

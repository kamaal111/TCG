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
import { ConfigStore } from '../infra/config.ts';
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
    'Signing uses Xcode automatic signing. Uploads use your App Store Connect email and an app-specific password from account.apple.com → Sign-In and Security → App-Specific Passwords. Credentials are saved only in your private settings directory, never in Git. Use an app-specific password, not your main Apple Account password.',
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

  const savedAuthentication = await readAppAuthentication(directory).catch(() => undefined);

  const email =
    !edit && savedAuthentication
      ? savedAuthentication.email
      : await prompts.text({
          message: 'App Store Connect email',
          initialValue: savedAuthentication?.email,
          validate: value => {
            return AppAuthenticationSchema.shape.email.safeParse(value).success
              ? undefined
              : 'Enter your App Store Connect email.';
          },
        });

  const password =
    !edit && savedAuthentication
      ? savedAuthentication.password
      : await prompts.password('App Store Connect app-specific password');

  const authentication = AppAuthenticationSchema.parse({ email, password });
  await saveAppSettings(directory, { version: 1, teamID, apiHost });
  await saveAppAuthentication(directory, authentication);
  prompts.note(
    `Saved private release settings.\nTeam: ${teamID}\nAPI: https://${apiHost}\nUpload email and app-specific password are saved privately.`,
  );
}

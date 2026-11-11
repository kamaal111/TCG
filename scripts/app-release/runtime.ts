import fs from 'node:fs/promises';
import path from 'node:path';

import z from 'zod';

import { appCommands } from './commands.ts';
import { APP_ALREADY_UPLOADED, appFingerprint, readAppSettings, type Platform } from './config.ts';
import { appReleaseEnvironment } from './environment.ts';
import { archiveArguments, exportOptions, inspectArchive, type Command } from './xcode.ts';
import { gitAddDetachedWorktree, gitFetch, gitRemoveWorktree, gitRevision } from '../git.ts';
import { InfraFailure } from '../infra/errors.ts';
import type { Prompts } from '../infra/prompts.ts';
import { selectRelease } from '../release/commits.ts';
import { acquireLocalLease } from '../release/lock.ts';

export type AppStage = 'checks' | 'archive' | 'upload';

export interface AppRuntimeOptions {
  root: string;
  configDirectory: string;
  platform: Platform;
  revision: string;
  prompts: Prompts;
  reviewedFingerprint?: string;
  stage?: (stage: AppStage) => void;
  command?: Command;
  signal?: AbortSignal;
}

const SummarySchema = z.object({
  platform: z.enum(['ios', 'macos']),
  sha: z.string(),
  fingerprint: z.string(),
  state: z.enum(['started', 'uploading', 'uploaded', 'failed']),
  createdAt: z.string(),
});

export async function lastAppUpload(directory: string, platform: Platform) {
  const releases = path.join(directory, 'app-releases');

  const names = await fs.readdir(releases).catch(error => {
    if (z.object({ code: z.literal('ENOENT') }).safeParse(error).success) {
      return [];
    }

    throw error;
  });

  const records = [];

  for (const name of names) {
    const source = await fs.readFile(path.join(releases, name, 'summary.json'), 'utf8').catch(error => {
      if (z.object({ code: z.literal('ENOENT') }).safeParse(error).success) {
        return '';
      }

      throw error;
    });

    if (!source) {
      continue;
    }

    const record = SummarySchema.parse(JSON.parse(source));

    if (record.platform === platform && record.state === 'uploaded') {
      records.push(record);
    }
  }

  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export async function inspectAppSource(root: string, revision: string, command: Command) {
  await gitFetch((program, args) => command(program, args, root));
  const main = await gitRevision((program, args) => command(program, args, root), 'origin/main');
  const sha = await selectRelease((program, args) => command(program, args, root), revision, main);
  const config = await command('git', ['show', `${sha}:app/Configuration/App.xcconfig`], root);
  const version = /^MARKETING_VERSION\s*=\s*([0-9]+(?:\.[0-9]+){0,2})\s*$/m.exec(config)?.[1];

  if (!version) {
    throw new InfraFailure('The selected commit has no supported marketing version in App.xcconfig.');
  }

  return { sha, version };
}

export async function runAppRelease(options: AppRuntimeOptions): Promise<void> {
  const { root, configDirectory, platform, prompts } = options;

  if (!options.command && process.platform !== 'darwin') {
    throw new InfraFailure('App releases require the release Mac with Xcode.');
  }

  const settings = await readAppSettings(configDirectory);
  const state = path.join(configDirectory, 'app-releases');
  await fs.mkdir(state, { recursive: true, mode: 0o700 });
  await fs.chmod(state, 0o700);
  const session = await fs.mkdtemp(path.join(state, `${platform}-`));
  const log = path.join(session, 'release.log');
  await fs.writeFile(log, '', { mode: 0o600 });

  const environment = options.command ? undefined : await appReleaseEnvironment({ root });
  const command = options.command ?? appCommands({ root, log, signal: options.signal, environment });
  const cleanup = options.command ?? appCommands({ root, log, environment });

  prompts.note(`Detailed output and artifacts are saved privately in ${session}.`);
  let added = false;
  const checkout = path.join(session, 'source');
  let summary: z.infer<typeof SummarySchema> | undefined;

  async function save(next: z.infer<typeof SummarySchema>) {
    summary = next;
    const temporary = path.join(session, 'summary.tmp');
    await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(temporary, path.join(session, 'summary.json'));
  }

  try {
    const { sha, version } = await inspectAppSource(root, options.revision, command);
    const fingerprint = appFingerprint(platform, sha, settings);
    await save({ platform, sha, fingerprint, state: 'started', createdAt: new Date().toISOString() });

    if (options.reviewedFingerprint && options.reviewedFingerprint !== fingerprint) {
      throw new InfraFailure('App release settings changed. Refresh and review again.');
    }

    const previous = await lastAppUpload(configDirectory, platform);

    if (previous?.fingerprint === fingerprint) {
      throw new InfraFailure(`${APP_ALREADY_UPLOADED} Select a new merged commit.`);
    }

    async function assertSettings() {
      if (appFingerprint(platform, sha, await readAppSettings(configDirectory)) !== fingerprint) {
        throw new InfraFailure('App release settings changed. Refresh and review again.');
      }
    }

    const review = { platform, sha, version, teamID: settings.teamID, apiHost: settings.apiHost, fingerprint };
    prompts.note(
      `Platform: ${platform}\nCommit: ${sha}\nVersion: ${version}\nBundle: io.kamaal.TCG\nTeam: ${settings.teamID}\nAPI: https://${settings.apiHost}`,
    );
    options.stage?.('checks');
    await gitAddDetachedWorktree((program, args) => command(program, args, root), checkout, sha);
    added = true;
    await command('mise', ['exec', '--locked', 'node', 'pnpm', '--', 'pnpm', 'install', '--frozen-lockfile'], checkout);
    await command('just', ['ready-app'], checkout);
    options.stage?.('archive');

    if (
      !(await prompts.confirm(
        'Archive and sign this app? Xcode may create or update certificates, app IDs and provisioning profiles.',
        false,
        { kind: 'provision', appReview: review },
      ))
    ) {
      throw new InfraFailure('App release cancelled before signing.', 130);
    }

    await assertSettings();
    const archive = path.join(session, 'Mintomo.xcarchive');
    await command('xcodebuild', archiveArguments({ platform, archive, settings }), checkout);
    await inspectArchive({ archive, platform, settings, version, command });
    const plist = path.join(session, 'ExportOptions.plist');
    await fs.writeFile(plist, exportOptions(settings), { mode: 0o600 });
    options.stage?.('upload');

    if (
      !(await prompts.confirm(
        'Upload this signed archive to App Store Connect? Xcode will manage the upload build number. This does not submit for App Review.',
        false,
        { kind: 'upload', appReview: review },
      ))
    ) {
      throw new InfraFailure('App release cancelled before upload.', 130);
    }

    await assertSettings();
    await save({ platform, sha, fingerprint, state: 'uploading', createdAt: new Date().toISOString() });
    await command(
      'xcodebuild',
      [
        '-exportArchive',
        '-archivePath',
        archive,
        '-exportOptionsPlist',
        plist,
        '-exportPath',
        path.join(session, 'export'),
        '-allowProvisioningUpdates',
      ],
      checkout,
    );
    await save({ platform, sha, fingerprint, state: 'uploaded', createdAt: new Date().toISOString() });
    prompts.note(
      'Uploaded to App Store Connect; processing pending. Check https://appstoreconnect.apple.com for the final build number and processing result.',
    );
  } catch (error) {
    if (summary && summary.state !== 'uploaded') {
      await save({ ...summary, state: 'failed' });
    }

    throw error;
  } finally {
    if (added) {
      await gitRemoveWorktree((program, args) => cleanup(program, args, root), { path: checkout, force: true });
    }
  }
}

export async function releaseAppFromTerminal(options: AppRuntimeOptions): Promise<void> {
  const unlock = await acquireLocalLease(options.configDirectory, 'app-release');

  try {
    await runAppRelease(options);
  } finally {
    await unlock();
  }
}

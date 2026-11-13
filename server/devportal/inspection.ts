import childProcess from 'node:child_process';
import util from 'node:util';

import { ServiceUnavailable } from '@tcg/http/exceptions';
import z from 'zod';

import { AppStatusSchema, ServerSchema, type AppStatus, type ServerStatus } from './contracts.ts';
import {
  APP_ALREADY_UPLOADED,
  APP_SETUP_REQUIRED,
  appFingerprint,
  readAppSettings,
  readAppAuthentication,
  type Platform,
} from '../../scripts/app-release/config.ts';
import { inspectAppSource, lastAppUpload } from '../../scripts/app-release/runtime.ts';
import type { Command } from '../../scripts/app-release/runtime.ts';
import { gitCommitExists, gitFetch, gitRevision } from '../../scripts/git.ts';
import { pendingCommits } from '../../scripts/release/commits.ts';
import { releaseConnection } from '../../scripts/release/connection.ts';
import { HostSchema } from '../../scripts/release/contracts.ts';
import { inspectServerSetup, PORTAL_SETUP_REQUIRED } from '../../scripts/release/server-setup.ts';

const execute = util.promisify(childProcess.execFile);

interface ReleaseSettings {
  root: string;
  configDirectory: string;
}

/** The commit comparison is separate from SSH, allowing real Git fixtures in tests. */
async function inspectGit(root: string, host: z.infer<typeof HostSchema> | null, page: number) {
  const gitCommand = async (program: string, args: string[]) => {
    return (await execute(program, args, { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 30000 })).stdout.trim();
  };

  await gitFetch(gitCommand, { noTags: true });

  if (host?.revision) {
    const revision = host.revision;

    const exists = await gitCommitExists(gitCommand, revision).then(
      () => true,
      () => false,
    );

    if (!exists) {
      await gitFetch(gitCommand, { noTags: true, revision });
    }
  }

  const main = await gitRevision(gitCommand, 'origin/main');

  return pendingCommits(gitCommand, host?.revision ?? null, main, page);
}

export async function inspectServer(options: ReleaseSettings, page: number): Promise<ServerStatus> {
  try {
    const { environment: env } = await releaseConnection(options.root, options.configDirectory);

    const host = await inspectHost(options, env);

    const git = await inspectGit(options.root, host, page);
    let blocker = git.blocker;

    if (host?.busy) {
      blocker = 'The server is busy with another deployment or configuration.';
    }

    if (host && host.repository !== env.TCG_IMAGE_REPOSITORY) {
      blocker = 'The server registry differs from release settings.';
    }

    const setup = await inspectServerSetup(
      async (program, args) => {
        return (await execute(program, args, { cwd: options.root, timeout: 30000 })).stdout.trim();
      },
      host,
      git.main,
    );

    if (setup.setupChanged) {
      blocker = PORTAL_SETUP_REQUIRED;
    }

    // The runtime performs the complete settings/checkpoint preflight again before building.
    return ServerSchema.parse({
      ...git,
      target: env.TCG_DEPLOY_HOST,
      host,
      blocker,
      activeRelease: null,
      latestRelease: null,
    });
  } catch (cause) {
    throw new ServiceUnavailable(undefined, {
      code: 'INSPECTION_UNAVAILABLE',
      message: 'Cannot inspect the release target. Check Git, release settings, Tailscale and SSH on the Mac mini.',
      cause,
    });
  }
}

async function inspectHost(options: ReleaseSettings, env: NodeJS.ProcessEnv) {
  try {
    const result = await execute('bash', ['scripts/deployment-ssh.sh', 'status'], {
      cwd: options.root,
      env,
      timeout: 30000,
    });

    return HostSchema.parse(JSON.parse(result.stdout));
  } catch (error) {
    if (z.object({ code: z.literal(64) }).safeParse(error).success) {
      return null;
    }

    throw error;
  }
}

export async function inspectApp(options: ReleaseSettings, platform: Platform, page: number): Promise<AppStatus> {
  try {
    return await inspectAppReview(options, platform, page);
  } catch (cause) {
    throw new ServiceUnavailable(undefined, {
      code: 'APP_INSPECTION_UNAVAILABLE',
      message: 'Cannot inspect the app release. Check Git and private app release history on the release Mac.',
      cause,
    });
  }
}

async function inspectAppReview(options: ReleaseSettings, platform: Platform, page: number): Promise<AppStatus> {
  const command: Command = async (program, args, cwd = options.root) => {
    return (await execute(program, args, { cwd, timeout: 30000 })).stdout.trim();
  };

  const { sha, version } = await inspectAppSource(options.root, 'origin/main', command);
  const settings = await readAppSettings(options.configDirectory).catch(() => null);
  const uploaded = await lastAppUpload(options.configDirectory, platform);
  const git = await pendingCommits((program, args) => command(program, args), uploaded?.sha ?? null, sha, page);

  let blocker = APP_SETUP_REQUIRED;

  if (settings) {
    blocker =
      uploaded?.fingerprint === appFingerprint(platform, sha, settings) ? APP_ALREADY_UPLOADED : (git.blocker ?? '');

    if (!(await readAppAuthentication(options.configDirectory).catch(() => null))) {
      blocker =
        'Upload setup is required. Run just setup-app-release on the release Mac to save private upload credentials.';
    }
  }

  return AppStatusSchema.parse({
    ...git,
    platform,
    target: platform === 'ios' ? 'Mintomo iOS · App Store Connect' : 'Mintomo macOS · App Store Connect',
    host: null,
    uploaded: uploaded?.sha ?? null,
    fingerprint: settings ? appFingerprint(platform, sha, settings) : null,
    version,
    teamID: settings?.teamID ?? null,
    apiHost: settings?.apiHost ?? null,
    blocker: blocker || null,
    activeRelease: null,
    latestRelease: null,
  });
}

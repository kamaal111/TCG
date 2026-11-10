import childProcess from 'node:child_process';
import util from 'node:util';

import { ServiceUnavailable } from '@tcg/http/exceptions';
import z from 'zod';

import { ServerSchema, type ServerStatus } from './contracts.ts';
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

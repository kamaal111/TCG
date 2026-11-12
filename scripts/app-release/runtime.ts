import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

import z from 'zod';

import type { Platform } from './config.ts';
import { gitFetch, gitRevision } from '../git.ts';
import { InfraFailure } from '../infra/errors.ts';
import type { Prompts } from '../infra/prompts.ts';
import { selectRelease } from '../release/commits.ts';

export type Command = (program: string, args: string[], cwd?: string) => Promise<string>;

export type AppStage = 'checks' | 'archive' | 'upload';

export interface AppRuntimeOptions {
  root: string;
  configDirectory: string;
  platform: Platform;
  revision: string;
  prompts: Prompts;
  reviewedFingerprint?: string;
  stage?: (stage: AppStage) => void;
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

/** Devportal bridge; the same shell pipeline is called directly by just. */
export async function runAppRelease(options: AppRuntimeOptions): Promise<void> {
  if (options.signal?.aborted) {
    throw new InfraFailure('App release cancelled before starting.', 130);
  }

  const child = childProcess.spawn(
    'bash',
    [
      path.join(options.root, 'scripts/app-release.sh'),
      'release',
      options.platform,
      options.revision,
      '--config-dir',
      options.configDirectory,
    ],
    {
      cwd: options.root,
      env: {
        ...process.env,
        TCG_APP_PORTAL_EVENTS: '1',
        TCG_APP_LEASE_PID: String(process.pid),
        TCG_APP_REVIEWED_FINGERPRINT: options.reviewedFingerprint ?? '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const lines = readline.createInterface({ input: child.stdout });
  const stageSchema = z.enum(['checks', 'archive', 'upload']);
  let diagnostics = '';
  let failure = '';

  const abort = () => {
    child.kill('SIGTERM');
  };

  options.signal?.addEventListener('abort', abort, { once: true });

  if (options.signal?.aborted) {
    abort();
  }

  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    diagnostics = (diagnostics + chunk).slice(-16000);
  });
  lines.on('line', line => {
    const [kind, stage, ...message] = line.split('\t');
    const parsed = stageSchema.safeParse(stage);

    if (kind === 'TCG_APP_EVENT' && parsed.success) {
      if (message.join('\t').startsWith('Stopped:')) {
        failure = message.join('\t');
      }

      options.stage?.(parsed.data);
      options.prompts.note(message.join('\t'));
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', cause => reject(new InfraFailure(`Could not start app release: ${cause.message}`)));
      child.once('close', code => {
        if (code === 0 && !options.signal?.aborted) {
          resolve();
        } else {
          reject(
            new InfraFailure(
              diagnostics.trim() || failure || 'App release stopped. Read the private shell release log.',
              options.signal?.aborted ? 130 : code || 1,
            ),
          );
        }
      });
    });
  } finally {
    options.signal?.removeEventListener('abort', abort);
    lines.close();
  }
}

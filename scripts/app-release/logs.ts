import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import z from 'zod';

import type { Platform } from './config.ts';
import { InfraFailure } from '../infra/errors.ts';

/** Follow the latest session with the system tail command; never start a release. */
export async function followAppReleaseLog(directory: string, platform?: Platform): Promise<void> {
  const sessions = path.join(directory, 'app-releases');

  const missing = new InfraFailure(
    'No app release log found. Start just release-ios or just release-macos, then run just logs-app-release in another tab.',
  );

  const candidates = await fs.readdir(sessions, { withFileTypes: true }).catch(cause => {
    if (z.object({ code: z.literal('ENOENT') }).safeParse(cause).success) {
      throw missing;
    }

    throw cause;
  });

  const logs = [];

  for (const candidate of candidates) {
    if (
      !candidate.isDirectory() ||
      !/^(ios|macos)-/.test(candidate.name) ||
      (platform && !candidate.name.startsWith(`${platform}-`))
    ) {
      continue;
    }

    const log = path.join(sessions, candidate.name, 'release.log');

    const stat = await fs.stat(log).catch(cause => {
      if (z.object({ code: z.literal('ENOENT') }).safeParse(cause).success) {
        return null;
      }

      throw cause;
    });

    if (stat?.isFile()) {
      logs.push({ log, modified: stat.mtimeMs });
    }
  }

  const latest = logs.sort((a, b) => b.modified - a.modified)[0];

  if (!latest) {
    throw missing;
  }

  console.error(`Following ${latest.log}. Press Ctrl-C to stop watching.`);
  const child = childProcess.spawn('tail', ['-n', '100', '-F', latest.log], { stdio: 'inherit' });

  const stop = () => {
    child.kill('SIGTERM');
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', cause => reject(new InfraFailure(`Cannot follow app release log: ${cause.message}`)));
      child.once('close', (code, signal) => {
        if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
          resolve();
        } else {
          reject(new InfraFailure(`tail stopped with exit ${code}.`, code ?? 1));
        }
      });
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

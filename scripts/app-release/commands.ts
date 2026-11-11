import childProcess from 'node:child_process';
import fs from 'node:fs';
import promises from 'node:fs/promises';

import type { Command } from './xcode.ts';
import { InfraFailure } from '../infra/errors.ts';

interface CommandOptions {
  root: string;
  log: string;
  signal?: AbortSignal;
}

/** Keep the lease owner alive until command descendants and their output have stopped. */
export function appCommands({ root, log, signal }: CommandOptions): Command {
  return async (program, args, cwd = root) => {
    if (signal?.aborted) {
      throw new InfraFailure('App release cancelled. Check App Store Connect before retrying an upload.', 130);
    }

    await promises.appendFile(log, `\n${program} ${JSON.stringify(args)}\n`);
    const output = fs.createWriteStream(log, { flags: 'a', mode: 0o600 });

    // Keep app bundle permissions portable while the session parent stays private.
    const child = childProcess.spawn('bash', ['-c', 'umask 022; exec "$@"', '--', program, ...args], {
      cwd,
      env: { ...process.env, HUSKY: '0', MISE_TRUSTED_CONFIG_PATHS: cwd },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let captured = '';
    let logFailed = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const heartbeat = setInterval(() => console.log('Still running. This step can take several minutes.'), 30_000);

    const terminate = () => {
      const pid = child.pid;

      if (!pid) {
        return;
      }

      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        return;
      }

      escalation = setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          /* The command group already exited. */
        }
      }, 5000);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      output.write(chunk);
      captured = (captured + chunk.toString()).slice(-64 * 1024 * 1024);
    });
    child.stderr.on('data', (chunk: Buffer) => output.write(chunk));
    signal?.addEventListener('abort', terminate, { once: true });

    if (signal?.aborted) {
      terminate();
    }

    try {
      const result = await new Promise<number | null>((resolve, reject) => {
        child.once('error', () => {
          return reject(
            new InfraFailure(
              `Could not start ${program}. Check tools on the release Mac and the private log at ${log}.`,
            ),
          );
        });
        child.once('close', code => resolve(code));
        output.once('error', () => {
          terminate();
          logFailed = true;
        });
      });

      if (result !== 0 || signal?.aborted || logFailed) {
        throw new InfraFailure(
          `App release stopped. Check the private log at ${log}. If upload started, check App Store Connect before retrying. For signing failures check Xcode Accounts and unlock Keychain on the release Mac.`,
          signal?.aborted ? 130 : 1,
        );
      }

      return captured.trim();
    } finally {
      signal?.removeEventListener('abort', terminate);
      clearInterval(heartbeat);
      clearTimeout(escalation);

      if (!output.destroyed) {
        await new Promise<void>(resolve => output.end(resolve));
      }
    }
  };
}

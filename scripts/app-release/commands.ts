import childProcess from 'node:child_process';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import util from 'node:util';

import type { Command } from './xcode.ts';
import { InfraFailure } from '../infra/errors.ts';

interface CommandOptions {
  root: string;
  log: string;
  signal?: AbortSignal;
  environment?: NodeJS.ProcessEnv;
  output?: (chunk: string) => void;
  idleTimeoutMs?: number;
}

/** Keep the lease owner alive until command descendants and their output have stopped. */
export function appCommands({
  root,
  log,
  signal,
  environment = process.env,
  output: liveOutput,
  idleTimeoutMs = 10 * 60_000,
}: CommandOptions): Command {
  return async (program, args, cwd = root) => {
    if (signal?.aborted) {
      throw new InfraFailure('App release cancelled before starting the next command.', 130);
    }

    await promises.appendFile(log, `\n${program} ${JSON.stringify(args)}\n`, { mode: 0o600 });
    liveOutput?.(`\nRunning: ${program} ${JSON.stringify(args)}\n`);
    const output = fs.createWriteStream(log, { flags: 'a', mode: 0o600 });

    // Keep app bundle permissions portable while the session parent stays private.
    const child = childProcess.spawn('bash', ['-c', 'umask 022; exec "$@"', '--', program, ...args], {
      cwd,
      env: { ...environment, HUSKY: '0', MISE_TRUSTED_CONFIG_PATHS: cwd },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let captured = '';
    let diagnostics = '';
    let truncated = false;
    let logFailure: string | undefined;
    let idleFailure = false;
    let lastOutput = performance.now();
    let escalation: ReturnType<typeof setTimeout> | undefined;

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

    const watchdog = setInterval(
      () => {
        if (!idleFailure && performance.now() - lastOutput >= idleTimeoutMs) {
          idleFailure = true;
          terminate();
        }
      },
      Math.min(30_000, idleTimeoutMs),
    );

    function record(chunk: string) {
      lastOutput = performance.now();
      output.write(chunk);
      liveOutput?.(chunk);
      const combined = diagnostics + chunk;
      truncated ||= combined.length > 256 * 1024;
      diagnostics = combined.slice(-256 * 1024);
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      record(chunk);
      captured = (captured + chunk).slice(-64 * 1024 * 1024);
    });
    child.stderr.on('data', record);
    signal?.addEventListener('abort', terminate, { once: true });

    if (signal?.aborted) {
      terminate();
    }

    try {
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once('error', error => {
          return reject(new InfraFailure(`Could not start ${program}: ${error.message}\nFull log: ${log}`));
        });
        child.once('close', (code, signal) => resolve({ code, signal }));
        output.once('error', error => {
          terminate();
          logFailure = error.message;
        });
      });

      if (result.code !== 0 || signal?.aborted || logFailure || idleFailure) {
        const invocation = [program, ...args]
          .map(argument => (/\s/.test(argument) ? JSON.stringify(argument) : argument))
          .join(' ');

        let status = result.signal ? `signal ${result.signal}` : `exit ${result.code}`;

        if (logFailure) {
          status = 'log write failure';
        }

        const outcome = signal?.aborted ? 'cancelled' : 'failed';
        const details = util.stripVTControlCharacters(diagnostics).trim();

        const message = [
          `Command ${outcome} (${status}): ${invocation}`,
          idleFailure
            ? `No tool output for ${Math.round(idleTimeoutMs / 1000)} seconds; stopped the unresponsive command.`
            : '',
          logFailure ? `Cannot write the release log: ${logFailure}` : '',
          truncated ? 'Earlier output omitted; the complete output is in the log.' : '',
          details || 'The command produced no output.',
          `Full log: ${log}`,
          program === 'xcodebuild' && args.includes('-exportArchive')
            ? 'An upload may have been received. Check App Store Connect before retrying.'
            : '',
        ]
          .filter(Boolean)
          .join('\n\n');

        let exitCode = result.code || 1;

        if (idleFailure) {
          exitCode = 124;
        }

        if (signal?.aborted) {
          exitCode = 130;
        }

        throw new InfraFailure(message, exitCode);
      }

      return captured.trim();
    } finally {
      signal?.removeEventListener('abort', terminate);
      clearTimeout(escalation);
      clearInterval(watchdog);

      if (!output.destroyed) {
        await new Promise<void>(resolve => output.end(resolve));
      }
    }
  };
}

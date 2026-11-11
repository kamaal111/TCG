import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';

import z from 'zod';

import { InfraFailure } from '../infra/errors.ts';

const execute = util.promisify(childProcess.execFile);

interface EnvironmentOptions {
  root: string;
  environment?: NodeJS.ProcessEnv;
}

/** Resolve just once in the project so nested checks can run outside its tool-version context. */
export async function appReleaseEnvironment({
  root,
  environment = process.env,
}: EnvironmentOptions): Promise<NodeJS.ProcessEnv> {
  let candidates: string[];

  try {
    const result = await execute('/usr/bin/which', ['-a', 'just'], { cwd: root, env: environment });
    candidates = result.stdout.trim().split('\n').filter(Boolean);
  } catch (cause) {
    if (z.object({ code: z.literal(1) }).safeParse(cause).success) {
      throw new InfraFailure('Cannot run app release checks: just was not found on PATH.', 127);
    }

    throw new InfraFailure(
      `Cannot locate just: ${cause instanceof Error ? cause.message : 'executable lookup failed'}`,
    );
  }

  let shimFailure = '';

  for (const candidate of candidates) {
    let executable = await fs.realpath(path.resolve(root, candidate));

    if (path.basename(executable) === 'mise') {
      try {
        const resolved = await execute(executable, ['which', 'just'], { cwd: root, env: environment });
        executable = await fs.realpath(path.resolve(root, resolved.stdout.trim()));
        await fs.access(executable, fs.constants.X_OK);
      } catch (cause) {
        shimFailure = cause instanceof Error ? cause.message : 'mise could not resolve just';
        continue;
      }

      if (path.basename(executable) === 'mise') {
        continue;
      }
    }

    return { ...environment, PATH: `${path.dirname(executable)}${path.delimiter}${environment.PATH ?? ''}` };
  }

  throw new InfraFailure(
    `Cannot run app release checks: just resolves only to an inactive mise shim.\n${shimFailure}`,
    127,
  );
}

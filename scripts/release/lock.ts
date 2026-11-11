import fs from 'node:fs/promises';
import path from 'node:path';

import { Conflict } from '@tcg/http/exceptions';
import z from 'zod';

/** A machine-local lease shared by guided terminal and portal releases. */
export function acquireReleaseLock(configDirectory: string): Promise<() => Promise<void>> {
  return acquireLocalLease(configDirectory, 'release');
}

export async function acquireLocalLease(
  configDirectory: string,
  name: 'release' | 'devportal' | 'app-release',
): Promise<() => Promise<void>> {
  await fs.mkdir(configDirectory, { recursive: true, mode: 0o700 });
  const directory = path.join(configDirectory, `${name}.lock`);
  const reclaim = `${directory}.reclaim`;

  const busy = () => {
    return new Conflict({
      message: `Another ${name} is running on this Mac.`,
      code: name === 'devportal' ? 'SERVICE_BUSY' : 'RELEASE_BUSY',
    });
  };

  async function create(): Promise<() => Promise<void>> {
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.writeFile(path.join(directory, 'pid'), String(process.pid), { mode: 0o600 });

    return () => fs.rm(directory, { recursive: true, force: true });
  }

  try {
    await fs.access(reclaim);
    throw busy();
  } catch (error) {
    if (!z.object({ code: z.literal('ENOENT') }).safeParse(error).success) {
      throw error;
    }
  }

  try {
    return await create();
  } catch (error) {
    if (!z.object({ code: z.literal('EEXIST') }).safeParse(error).success) {
      throw error;
    }
  }

  const pid = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(await fs.readFile(path.join(directory, 'pid'), 'utf8').catch(() => ''));

  if (!pid.success) {
    throw busy();
  }

  try {
    process.kill(pid.data, 0);
    throw busy();
  } catch (error) {
    if (!z.object({ code: z.literal('ESRCH') }).safeParse(error).success) {
      throw error;
    }
  }

  try {
    await fs.mkdir(reclaim, { mode: 0o700 });
  } catch {
    throw busy();
  }

  try {
    if ((await fs.readFile(path.join(directory, 'pid'), 'utf8')) !== String(pid.data)) {
      throw busy();
    }

    await fs.rm(directory, { recursive: true });

    return await create();
  } finally {
    await fs.rm(reclaim, { recursive: true, force: true });
  }
}

/** Prevent service replacement while either release runtime owns child commands. */
export async function acquireAllReleaseLocks(directory: string): Promise<() => Promise<void>> {
  const server = await acquireReleaseLock(directory);

  try {
    const app = await acquireLocalLease(directory, 'app-release');

    return async () => {
      await app();
      await server();
    };
  } catch (error) {
    await server();
    throw error;
  }
}

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { acquireReleaseLock } from './lock.ts';

test('guided and portal releases cannot hold the same configuration lease concurrently', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mintomo lease-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  const unlock = await acquireReleaseLock(directory);
  await expect(acquireReleaseLock(directory)).rejects.toThrow('Another release');
  await unlock();
  const next = await acquireReleaseLock(directory);
  await next();
});

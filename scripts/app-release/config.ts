import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import z from 'zod';

import { readSettingsFile } from '../infra/config.ts';
import { InfraFailure } from '../infra/errors.ts';

export const PlatformSchema = z.enum(['ios', 'macos']);

export type Platform = z.infer<typeof PlatformSchema>;

export const APP_ALREADY_UPLOADED = 'This source and app configuration were already uploaded.';

export const APP_SETUP_REQUIRED = 'App release setup is required. Run just setup-app-release on the release Mac.';

const HostSchema = z
  .string()
  .regex(/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/)
  .refine(value => value.toLowerCase() !== 'api.example.com' && !value.toLowerCase().endsWith('.localhost'));

export const AppSettingsSchema = z.strictObject({
  version: z.literal(1),
  teamID: z.string().regex(/^[A-Z0-9]{10}$/),
  apiHost: HostSchema,
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export async function readAppSettings(directory: string): Promise<AppSettings> {
  try {
    return AppSettingsSchema.parse(JSON.parse(await readSettingsFile(path.join(directory, 'app-release.json'))));
  } catch {
    throw new InfraFailure(APP_SETUP_REQUIRED);
  }
}

export async function saveAppSettings(directory: string, input: AppSettings): Promise<void> {
  const settings = AppSettingsSchema.parse(input);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temporary = path.join(directory, `.app-release-${crypto.randomUUID()}`);

  try {
    await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, path.join(directory, 'app-release.json'));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function appFingerprint(platform: Platform, sha: string, settings: AppSettings): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([platform, sha, settings]))
    .digest('hex');
}

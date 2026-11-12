import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { sha256Hex } from '@tcg/crypto/sha256';
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

export const AppAuthenticationSchema = z.strictObject({
  email: z.email().trim().toLowerCase(),
  password: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9]{4}(?:-[A-Za-z0-9]{4}){3}$/,
      'Use an Apple app-specific password, not your main Apple Account password.',
    ),
});

export async function readAppAuthentication(directory: string) {
  return AppAuthenticationSchema.parse(
    JSON.parse(await readSettingsFile(path.join(directory, 'app-store-connect.json'))),
  );
}

export async function readAppSettings(directory: string): Promise<AppSettings> {
  try {
    return AppSettingsSchema.parse(JSON.parse(await readSettingsFile(path.join(directory, 'app-release.json'))));
  } catch {
    throw new InfraFailure(APP_SETUP_REQUIRED);
  }
}

export async function saveAppSettings(directory: string, input: AppSettings): Promise<void> {
  await savePrivateSettings(directory, 'app-release.json', AppSettingsSchema.parse(input));
}

export async function saveAppAuthentication(
  directory: string,
  input: z.infer<typeof AppAuthenticationSchema>,
): Promise<void> {
  await savePrivateSettings(directory, 'app-store-connect.json', AppAuthenticationSchema.parse(input));
}

const SigningSchema = z.object({
  version: z.literal(1),
  teamID: z.string().regex(/^[A-Z0-9]{10}$/),
  profileUUID: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
  certificateSHA1: z.string().regex(/^[A-F0-9]{40}$/),
  installerSHA1: z
    .string()
    .regex(/^[A-F0-9]{40}$/)
    .optional(),
});

export async function readAppSigning(directory: string, platform: Platform, team: string) {
  const signing = SigningSchema.parse(
    JSON.parse(await fs.readFile(path.join(directory, 'app-signing', `${platform}.json`), 'utf8')),
  );

  if (
    signing.teamID !== team ||
    Date.parse(signing.expiresAt) <= Date.now() ||
    (platform === 'macos' && !signing.installerSHA1)
  ) {
    throw new InfraFailure(
      `Local ${platform} distribution signing needs setup. Run just setup-app-release --platform ${platform}.`,
    );
  }

  return signing;
}

async function savePrivateSettings(
  directory: string,
  filename: string,
  settings: AppSettings | z.infer<typeof AppAuthenticationSchema>,
): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temporary = path.join(directory, `.app-release-${crypto.randomUUID()}`);

  try {
    await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, path.join(directory, filename));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function appFingerprint(platform: Platform, sha: string, settings: AppSettings): string {
  return sha256Hex(JSON.stringify([platform, sha, settings]));
}

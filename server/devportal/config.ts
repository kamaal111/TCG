import fs from 'node:fs/promises';
import path from 'node:path';

import z from 'zod';

export const PortalSettingsSchema = z.strictObject({
  allowedLogins: z.array(z.string().regex(/^[^\s,\p{C}]+$/u)).nonempty(),
  port: z.number().int().min(1024).max(65535).default(8787),
});

export async function readPortalSettings(directory: string) {
  return PortalSettingsSchema.parse(JSON.parse(await fs.readFile(path.join(directory, 'devportal.json'), 'utf8')));
}

export async function savePortalSettings(
  directory: string,
  settings: z.input<typeof PortalSettingsSchema>,
): Promise<void> {
  const parsed = PortalSettingsSchema.parse(settings);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `devportal.${process.pid}.tmp`);

  try {
    await fs.writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, path.join(directory, 'devportal.json'));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

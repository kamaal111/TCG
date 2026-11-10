import path from 'node:path';

import z from 'zod';

import type { PortalCommands } from './commands.ts';
import { PortalSettingsSchema, readPortalSettings, savePortalSettings } from './config.ts';
import { portalHTTPSPort, verifyPortalServe, parseTailscaleIdentity, parseServeConfiguration } from './tailscale.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';
import type { Prompts } from '../../scripts/infra/prompts.ts';
import { releaseConnection } from '../../scripts/release/connection.ts';
import { acquireReleaseLock } from '../../scripts/release/lock.ts';

interface SetupOptions {
  root: string;
  configDirectory: string;
  tailscale: string;
  commands: PortalCommands;
  prompts: Prompts;
  installAgent: (directory: string) => Promise<void>;
}

function logins(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map(login => login.trim())
        .filter(Boolean),
    ),
  ];
}

export async function setupDevportal(options: SetupOptions): Promise<void> {
  const { root, configDirectory, tailscale, commands, prompts } = options;
  prompts.note(
    'This Mac will host Mintomo Devportal at login. Keep it awake with Docker and Tailscale running. Setup never starts a release.',
    'Mintomo Devportal setup',
  );

  for (const tool of ['git', 'docker', 'mise', 'just']) {
    commands.read('which', [tool]);
  }

  commands.read('docker', ['info', '--format', '{{.ServerVersion}}']);
  const identity = parseTailscaleIdentity(commands.read(tailscale, ['status', '--json']));

  try {
    await releaseConnection(root, configDirectory, {});
  } catch {
    if (!(await prompts.confirm('Release credentials need setup. Open the existing credential wizard now?'))) {
      throw new InfraFailure('Setup paused. Run just setup-devportal again when release credentials are available.');
    }

    commands.run('just', ['setup-infra', '--config-dir', configDirectory]);
    await releaseConnection(root, configDirectory, {});
  }

  let saved: z.output<typeof PortalSettingsSchema> | undefined;

  try {
    saved = await readPortalSettings(configDirectory);
  } catch (error) {
    if (!z.object({ code: z.literal('ENOENT') }).safeParse(error).success) {
      throw new InfraFailure(
        'Existing devportal.json is invalid or unreadable. Repair it before rerunning setup; it has been preserved.',
      );
    }
  }

  const allowedLogins = PortalSettingsSchema.shape.allowedLogins.parse(
    logins(
      await prompts.text({
        message: 'Who can view and release? Tailscale login names, separated by commas',
        initialValue: saved?.allowedLogins.join(', ') ?? identity.login,
        validate: value => {
          return PortalSettingsSchema.shape.allowedLogins.safeParse(logins(value)).success
            ? undefined
            : 'Enter at least one Tailscale login name without spaces.';
        },
      }),
    ),
  );

  const port = Number(
    await prompts.text({
      message: 'Local service port',
      initialValue: String(saved?.port ?? 8787),
      validate: value => {
        return PortalSettingsSchema.shape.port.safeParse(Number(value)).success
          ? undefined
          : 'Use a whole number between 1024 and 65535.';
      },
    }),
  );

  const settings = PortalSettingsSchema.parse({ allowedLogins, port });
  const readServe = () => parseServeConfiguration(commands.read(tailscale, ['serve', 'status', '--json']));
  const httpsPort = portalHTTPSPort(readServe(), identity.hostname, port);
  const address = `https://${identity.hostname}${httpsPort === 443 ? '' : `:${httpsPort}`}`;

  prompts.note(
    `App URL: ${address}\nOperators: ${allowedLogins.join(', ')}\nPrivate settings: ${path.join(configDirectory, 'devportal.json')}\nInstall or restart the login service; add private HTTPS on port ${httpsPort}.\nExisting release credentials, history and other Tailscale listeners are preserved.`,
    'Review setup',
  );

  if (!(await prompts.confirm('Save settings, install the login service and configure private HTTPS?', true))) {
    prompts.note('Portal settings and services were not changed. Rerun just setup-devportal whenever you are ready.');

    return;
  }

  const unlock = await acquireReleaseLock(configDirectory);

  try {
    if (portalHTTPSPort(readServe(), identity.hostname, port) !== httpsPort) {
      throw new InfraFailure('Tailscale listeners changed during review. Rerun setup to review the new endpoint.');
    }

    await savePortalSettings(configDirectory, settings);
    await options.installAgent(configDirectory);
    prompts.note(
      'Enabling private HTTPS. If Tailscale prints an approval link, open it and approve HTTPS for this tailnet, then return here.',
    );
    commands.run(tailscale, ['serve', '--bg', `--https=${httpsPort}`, `http://127.0.0.1:${port}`]);
    verifyPortalServe({ config: readServe(), hostname: identity.hostname, backendPort: port, httpsPort });
  } finally {
    await unlock();
  }

  prompts.note(
    `1. Connect Tailscale on your iPhone or Mac.\n2. Open Mintomo Devportal → Connection settings.\n3. Paste ${address}\n\nIf the device cannot connect, ask your tailnet administrator to allow the selected operators access to ${identity.address} on TCP ${httpsPort}.\nIf the dashboard reports deployment setup is required, run just release-server on this Mac to complete it.`,
    'Setup saved — connect your device',
  );
}

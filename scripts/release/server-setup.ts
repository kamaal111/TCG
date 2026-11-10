import { gitChangedFiles, gitCommitExists } from '../git.ts';
import type { Host } from './contracts.ts';
import type { Prompts } from '../infra/prompts.ts';

export const PORTAL_SETUP_REQUIRED = 'Server setup is required. Run just release-server on the Mac mini.';

interface ServerSetupQuestion {
  prompts: Prompts;
  reason: 'older-tools' | 'changed-settings';
}

export async function confirmServerSetup({ prompts, reason }: ServerSetupQuestion): Promise<boolean> {
  const introduction =
    reason === 'older-tools'
      ? 'Your server needs newer deployment commands before this release CLI can continue.'
      : 'Server settings or setup files have changed. Applying them is a separate step from releasing the app.';

  const declined =
    reason === 'older-tools'
      ? 'No stops this release attempt and leaves your deployed app running.'
      : 'No skips this setup step and continues the release with the server settings already in place.';

  prompts.note(
    [
      introduction,
      'Yes connects to your DigitalOcean server, updates deployment scripts, reapplies saved domain, database/storage settings, deployment SSH access and registry login, and checks Docker and Tailscale.',
      'It uses values you already saved. You do not need to enter new credentials. App deployment and database migrations have separate approvals.',
      declined,
    ].join('\n\n'),
    'Update server setup',
  );

  return prompts.confirm('Apply saved settings and update deployment scripts on the server?', false);
}

/** Shared by terminal preflight and the portal review; infrastructure-only edits remain optional. */
export async function inspectServerSetup(
  command: (program: string, args: string[]) => Promise<string>,
  host: Host | null | undefined,
  operations: string,
) {
  if (!host?.operationsRevision) {
    return { setupChanged: true, infrastructureSuggested: true };
  }

  const known = await gitCommitExists(command, host.operationsRevision).then(
    () => true,
    () => false,
  );

  if (!known) {
    return { setupChanged: true, infrastructureSuggested: true };
  }

  const changedFiles = await gitChangedFiles(command, {
    from: host.operationsRevision,
    to: operations,
    paths: ['infra', 'deploy', 'scripts/infrastructure.sh'],
  });

  return {
    setupChanged: changedFiles
      .split('\n')
      .some(
        file => file.startsWith('infra/ansible/') || file.startsWith('deploy/') || file === 'scripts/infrastructure.sh',
      ),
    infrastructureSuggested: Boolean(changedFiles),
  };
}

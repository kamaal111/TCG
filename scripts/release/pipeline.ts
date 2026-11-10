import type { Artifacts, Host } from './contracts.ts';
import { confirmServerSetup, PORTAL_SETUP_REQUIRED } from './server-setup.ts';
import { InfraFailure } from '../infra/errors.ts';
import type { Prompts } from '../infra/prompts.ts';

export type ReleaseStage = 'build' | 'migrations' | 'deploy' | 'verify';

interface Pipeline {
  mode?: 'terminal' | 'application';
  stage?(stage: ReleaseStage): void;
  prompts: Prompts;
  sha: string;
  repository: string;
  infrastructureSuggested: boolean;
  host(): Promise<Host | undefined>;
  commits(host: Host): Promise<string>;
  infrastructure(context: { serverConfigured: boolean }): Promise<void>;
  setup(context: { serverConfigured: boolean }): Promise<boolean>;
  configure(): Promise<void>;
  artifacts(): Promise<Artifacts>;
  verify(artifacts: Artifacts): Promise<void>;
  migrations(image: string): Promise<{ status: 'ready' | 'pending'; pending: number }>;
  migrate(image: string, fingerprint: string): Promise<void>;
  deploy(artifacts: Artifacts, host: Host): Promise<void>;
  check(): Promise<void>;
  complete(): Promise<void>;
}

function available(host: Host | undefined, repository: string): Host {
  if (!host) {
    throw new InfraFailure('The host needs updated release tools. Rerun and choose to configure the host.');
  }

  if (host.busy) {
    throw new InfraFailure('Another host configuration or release is running. Wait for it to finish, then rerun.');
  }

  if (host.repository !== repository) {
    throw new InfraFailure('The host registry differs from release.env. Check setup before continuing.');
  }

  return host;
}

async function approve(
  options: Pipeline,
  approval: { message: string; kind: 'migrations' | 'deploy'; pendingMigrations?: number },
): Promise<Host> {
  while (true) {
    const before = available(await options.host(), options.repository);
    options.prompts.note(
      `Target: ${before.hostname || 'private server'}\nRunning: ${before.revision?.slice(0, 12) ?? 'no release'}\nRelease: ${options.sha.slice(0, 12)}`,
    );

    options.prompts.note(await options.commits(before));

    if (
      !(await options.prompts.confirm(approval.message, false, {
        kind: approval.kind,
        review: {
          target: before.hostname || 'private server',
          running: before.revision,
          sha: options.sha,
          fingerprint: before.fingerprint,
          pendingMigrations: approval.pendingMigrations,
        },
      }))
    ) {
      throw new InfraFailure('Stopped before making this change. Rerun just release-server to continue.', 130);
    }

    const after = available(await options.host(), options.repository);

    if (before.fingerprint === after.fingerprint) {
      return after;
    }

    options.prompts.note(
      'The host changed while you were reviewing. Review the refreshed target before approving again.',
    );
  }
}

export async function runRelease(options: Pipeline): Promise<void> {
  const { prompts } = options;
  let host = await options.host();
  let serverConfigured = false;

  if (!host && options.mode === 'application') {
    throw new InfraFailure(PORTAL_SETUP_REQUIRED);
  }

  if (!host) {
    if (!(await confirmServerSetup({ prompts, reason: 'older-tools' }))) {
      throw new InfraFailure('Stopped. No release was deployed.', 130);
    }

    await options.configure();
    serverConfigured = true;
    host = await options.host();
  }

  prompts.note(await options.commits(available(host, options.repository)));

  if (
    options.mode !== 'application' &&
    (await prompts.confirm('Review an infrastructure plan?', options.infrastructureSuggested))
  ) {
    await options.infrastructure({ serverConfigured });
  }

  serverConfigured = (await options.setup({ serverConfigured })) || serverConfigured;

  options.stage?.('build');
  const artifacts = await options.artifacts();
  await options.verify(artifacts);
  options.stage?.('migrations');
  let readiness = await options.migrations(artifacts.migration);

  if (readiness.status === 'pending') {
    prompts.note(
      `${readiness.pending} migration step(s) are pending. Back up the database and confirm the running app supports the new schema. Migrations cannot be automatically undone.`,
    );

    const reviewed = await approve(options, {
      message: 'Apply these database migrations?',
      kind: 'migrations',
      pendingMigrations: readiness.pending,
    });

    // Recheck after approval: another release may have already applied them.
    readiness = await options.migrations(artifacts.migration);

    if (readiness.status === 'pending') {
      await options.migrate(artifacts.migration, reviewed.fingerprint);
    }

    readiness = await options.migrations(artifacts.migration);
  }

  if (readiness.status !== 'ready') {
    throw new InfraFailure('Migrations are still pending. Deployment was stopped.');
  }

  const current = available(await options.host(), options.repository);

  let healthy = false;

  if (!serverConfigured && current.runtime === artifacts.runtime && current.revision === options.sha) {
    prompts.note('The selected image is already installed. Checking the live release.');
    healthy = await options.check().then(
      () => true,
      () => false,
    );

    if (!healthy) {
      prompts.note('The installed release is unhealthy. Redeploying can restart the application and HTTPS proxy.');
    }
  }

  if (!healthy) {
    options.stage?.('deploy');

    const reviewed = await approve(options, {
      message: 'Deploy this release? The application will restart briefly.',
      kind: 'deploy',
    });

    await options.deploy(artifacts, reviewed);
    options.stage?.('verify');
    await options.check();
  }

  await options.complete();
  prompts.note('Release checks passed.', 'Released');
}

import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';

import z from 'zod';

import { gitAddDetachedWorktree, gitFetch, gitRemoveWorktree, gitRevision } from '../git.ts';
import { commitSummary, selectRelease } from './commits.ts';
import { releaseConnection } from './connection.ts';
import {
  ArtifactsSchema,
  fingerprint,
  HostSchema,
  migrationStatus,
  PlanSchema,
  ShaSchema,
  summarizePlan,
  type Artifacts,
} from './contracts.ts';
import { acquireReleaseLock } from './lock.ts';
import { runRelease, type ReleaseStage } from './pipeline.ts';
import { confirmServerSetup, inspectServerSetup, PORTAL_SETUP_REQUIRED } from './server-setup.ts';
import { readSettingsFile } from '../infra/config.ts';
import { credentials } from '../infra/credentials.ts';
import { InfraFailure } from '../infra/errors.ts';
import type { Prompts } from '../infra/prompts.ts';

const execute = util.promisify(childProcess.execFile);

const CheckpointSchema = z.object({
  version: z.literal(1),
  binding: z.string(),
  sha: ShaSchema,
  settings: z.string(),
  operations: ShaSchema,
  artifacts: ArtifactsSchema,
  complete: z.boolean(),
  configurationPending: z.boolean().default(false),
});

const CommandFailureSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  code: z.union([z.number(), z.string()]),
});

const ToolchainSchema = z.object({ Config: z.object({ Labels: z.record(z.string(), z.string()) }) });

interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RuntimeOptions {
  mode?: 'terminal' | 'application';
  reviewedFingerprint?: string;
  stage?: (stage: ReleaseStage) => void;
  root: string;
  configDirectory: string;
  revision: string;
  prompts: Prompts;
}

export async function releaseFromTerminal(options: RuntimeOptions): Promise<void> {
  const unlock = await acquireReleaseLock(options.configDirectory);

  try {
    await runReleaseRuntime(options);
  } finally {
    await unlock();
  }
}

export async function runReleaseRuntime({
  root,
  configDirectory,
  revision,
  prompts,
  mode = 'terminal',
  reviewedFingerprint,
  stage,
}: RuntimeOptions): Promise<void> {
  const { store, release, releaseEnvironment, settings, environment, key, hosts } = await releaseConnection(
    root,
    configDirectory,
  );

  const stateDirectory = path.join(configDirectory, 'releases');
  await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await fs.chmod(stateDirectory, 0o700);
  const session = await fs.mkdtemp(path.join(stateDirectory, '.session-'));
  await fs.chmod(session, 0o700);
  const log = path.join(session, 'release.log');
  await fs.writeFile(log, '', { mode: 0o600 });
  prompts.note(`Detailed output is saved privately in ${log}.`);

  async function command(
    program: string,
    args: string[],
    { cwd = root, env = environment }: CommandOptions = {},
  ): Promise<string> {
    const heartbeat = setInterval(() => console.log('Still running. This step can take several minutes.'), 30_000);

    await fs.appendFile(log, `\n${program} ${JSON.stringify(args)}\n`);

    try {
      const result = await execute(program, args, { cwd, env, maxBuffer: 64 * 1024 * 1024 });
      await fs.appendFile(log, result.stdout + result.stderr);

      return result.stdout.trim();
    } catch (error) {
      const result = CommandFailureSchema.safeParse(error);

      if (result.success) {
        await fs.appendFile(log, result.data.stdout + result.data.stderr);

        if (/unauthorized|denied|authentication|expired/i.test(result.data.stderr)) {
          prompts.note('A credential may have expired. Run just rotate-keys, then retry this release.');
          const credential = args[0]?.endsWith('/deployment-ssh.sh') ? 'download' : 'publishing';

          if (!args[0]?.endsWith('infrastructure.sh')) {
            prompts.note(credentials.find(item => item.id === credential)?.help.join('\n') ?? 'Check registry access.');
          }
        }
      }

      throw new InfraFailure(
        `This step failed. Read the private release log at ${log}, fix the cause, then rerun just release-server. Completed images can be reused; live state is checked again.`,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  function readableCommand(program: string, args: string[], options?: CommandOptions): Promise<string> {
    return command('bash', ['-c', 'umask 022; exec "$@"', '--', program, ...args], options);
  }

  const checkpointFile = path.join(stateDirectory, `${fingerprint([settings.TCG_DEPLOY_HOST])}.json`);
  const saved = await readSettingsFile(checkpointFile);
  const previous = CheckpointSchema.safeParse(saved ? JSON.parse(saved) : undefined);
  let configurationPending = previous.success && !previous.data.complete && previous.data.configurationPending;

  prompts.note('Fetching main and selecting the exact application commit.', '1. Select release');
  await gitFetch(command);
  const operations = ShaSchema.parse(await gitRevision(command, 'origin/main'));

  const resume =
    mode === 'terminal' &&
    revision === 'origin/main' &&
    previous.success &&
    !previous.data.complete &&
    (await prompts.confirm(`Resume the unfinished release ${previous.data.sha.slice(0, 12)}?`, true));

  const selected = resume && previous.success ? previous.data.sha : revision;

  const sha = await selectRelease(command, selected, operations);
  prompts.note(
    `Application: ${sha.slice(0, 12)}\nRelease tools: ${operations.slice(0, 12)}\nTarget: ${settings.TCG_DEPLOY_HOST}`,
  );

  const terraform = await Promise.all(
    ['terraform.tfvars', 'terraform.tfvars.json'].map(name => {
      return readSettingsFile(path.join(store.paths.terraformDirectory, name));
    }),
  );

  const infrastructureContents = await readSettingsFile(store.paths.infrastructure);

  const settingsHash = fingerprint([
    JSON.stringify(releaseEnvironment),
    key,
    hosts,
    ...terraform,
    infrastructureContents,
  ]);

  async function assertSettings(): Promise<void> {
    const current = await Promise.all([
      readSettingsFile(store.paths.release),
      readSettingsFile(environment.TCG_DEPLOY_KEY),
      readSettingsFile(environment.TCG_KNOWN_HOSTS),
      ...['terraform.tfvars', 'terraform.tfvars.json'].map(name => {
        return readSettingsFile(path.join(store.paths.terraformDirectory, name));
      }),
      readSettingsFile(store.paths.infrastructure),
    ]);

    if (fingerprint(current) !== fingerprint([release.contents, key, hosts, ...terraform, infrastructureContents])) {
      throw new InfraFailure(
        'Local settings changed during this release. Rerun to review the new settings before making changes.',
      );
    }
  }

  const binding = fingerprint([settings.TCG_DEPLOY_HOST, settings.TCG_IMAGE_REPOSITORY, sha, settingsHash]);

  let artifacts: Artifacts | undefined =
    previous.success && previous.data.binding === binding ? previous.data.artifacts : undefined;

  const opsRoot = path.join(session, 'operations');
  let worktreeAdded = false;

  async function checkpoint(complete: boolean): Promise<void> {
    if (!artifacts) {
      return;
    }

    const temporary = path.join(session, 'checkpoint.json');
    await fs.writeFile(
      temporary,
      JSON.stringify({
        version: 1,
        binding,
        sha,
        settings: settingsHash,
        operations,
        artifacts,
        complete,
        configurationPending: !complete && configurationPending,
      }),
      { mode: 0o600 },
    );
    await fs.rename(temporary, checkpointFile);
  }

  async function ops(): Promise<string> {
    if (!worktreeAdded) {
      // The parent stays private; tracked source and installed dependencies must be readable in Docker.
      await gitAddDetachedWorktree(readableCommand, opsRoot, operations);
      worktreeAdded = true;
      await readableCommand(
        'mise',
        ['exec', '--locked', 'node', 'pnpm', '--', 'pnpm', 'install', '--frozen-lockfile'],
        { cwd: opsRoot, env: { ...environment, HUSKY: '0', MISE_TRUSTED_CONFIG_PATHS: opsRoot } },
      );
    }

    return opsRoot;
  }

  async function remote(request: string): Promise<string> {
    if (request.startsWith('release-checked ') || request.startsWith('migrate-checked ')) {
      await assertSettings();
    }

    return command('bash', [path.join(root, 'scripts/deployment-ssh.sh'), request]);
  }

  let infrastructureEnvironment: NodeJS.ProcessEnv | undefined;

  async function infra(action: string): Promise<void> {
    await assertSettings();

    const directory = await ops();

    if (!infrastructureEnvironment) {
      const document = await store.readEnvironment('infrastructure');
      infrastructureEnvironment = { ...process.env, ...document.values, ...releaseEnvironment };
      const production = path.join(directory, 'infra/environments/production');

      for (const [index, name] of ['terraform.tfvars', 'terraform.tfvars.json'].entries()) {
        const contents = terraform[index];

        if (contents) {
          await fs.writeFile(path.join(production, name), contents, { mode: 0o600 });
        }
      }
    }

    await command('bash', ['scripts/infrastructure.sh', action], { cwd: directory, env: infrastructureEnvironment });
  }

  async function configure(): Promise<void> {
    prompts.note('Applying saved server settings and updating deployment scripts on your DigitalOcean server.');
    await infra('init');
    await infra('configure');
    configurationPending = true;
    await checkpoint(false);
  }

  const savedSettingsChanged = previous.success && previous.data.settings !== settingsHash;
  let serverInventoryChanged = false;

  async function host() {
    // Unsupported-command exit 64 is the only case treated as an older host.
    try {
      const result = await execute('bash', [path.join(root, 'scripts/deployment-ssh.sh'), 'status'], {
        cwd: root,
        env: environment,
      });

      await fs.appendFile(log, result.stdout + result.stderr);
      const parsed = HostSchema.parse(JSON.parse(result.stdout));

      return parsed;
    } catch (error) {
      const diagnostic = CommandFailureSchema.safeParse(error);

      if (diagnostic.success) {
        await fs.appendFile(log, diagnostic.data.stdout + diagnostic.data.stderr);
      }

      const unsupported = z.object({ code: z.literal(64) }).safeParse(error);

      if (unsupported.success) {
        return undefined;
      }

      throw new InfraFailure(
        `Cannot inspect the host. Check Tailscale, SSH and the verified host key. Details: ${log}`,
      );
    }
  }

  await command('docker', ['info', '--format', '{{.ServerVersion}}']);
  await command('docker', ['buildx', 'version']);
  const initial = await host();

  if (reviewedFingerprint && initial?.fingerprint !== reviewedFingerprint) {
    throw new InfraFailure('The server changed. Refresh the release review before starting again.');
  }

  const setupInspection = await inspectServerSetup(command, initial, operations);
  const serverSetupChanged = setupInspection.setupChanged;
  const suggested = !previous.success || savedSettingsChanged || setupInspection.infrastructureSuggested;

  try {
    await runRelease({
      mode,
      stage,
      prompts,
      sha,
      repository: settings.TCG_IMAGE_REPOSITORY,
      infrastructureSuggested: suggested,
      host,
      commits: current => commitSummary(command, current.revision, sha),
      configure: async () => {
        if (mode === 'application') {
          throw new InfraFailure(PORTAL_SETUP_REQUIRED);
        }

        await configure();
      },

      infrastructure: async () => {
        prompts.note(
          'Planning infrastructure. Only resource names and actions are shown here; full output stays in the private log.',
          '2. Infrastructure',
        );
        await infra('init');
        await infra('plan');
        const directory = await ops();

        const reviewedPlan = PlanSchema.parse(
          JSON.parse(
            await fs.readFile(path.join(directory, 'infra/environments/production/.terraform/review.json'), 'utf8'),
          ),
        );

        const plan = summarizePlan(reviewedPlan);

        const inventoryChanged =
          reviewedPlan.output_changes.inventory?.actions.some(action => action !== 'no-op') ?? false;

        prompts.note(plan.summary);

        let applied = false;

        if (plan.changed && (await prompts.confirm('Apply this infrastructure plan?', false))) {
          await infra('apply');
          applied = true;
        } else if (plan.changed) {
          prompts.note('Infrastructure apply was skipped.');
        }

        serverInventoryChanged = applied && inventoryChanged;
      },
      setup: async ({ serverConfigured }) => {
        const setupNeeded =
          serverInventoryChanged || (!serverConfigured && (savedSettingsChanged || serverSetupChanged));

        if (mode === 'application' && (setupNeeded || configurationPending)) {
          throw new InfraFailure(PORTAL_SETUP_REQUIRED);
        }

        if (!setupNeeded) {
          prompts.note('No server settings need to be applied. Continuing with the release.');
        } else if (await confirmServerSetup({ prompts, reason: 'changed-settings' })) {
          await configure();

          return true;
        }

        return configurationPending;
      },
      artifacts: async () => {
        if (!artifacts) {
          prompts.note(
            'Running server checks, building Linux images and publishing to GHCR. This can take several minutes.',
            '3. Build and publish',
          );
          const output = path.join(session, 'artifacts.json');
          await command('bash', [path.join(root, 'scripts/release-server.sh'), '--prepare', output, sha], {
            cwd: await ops(),
          });
          artifacts = ArtifactsSchema.parse(JSON.parse(await fs.readFile(output, 'utf8')));
          await checkpoint(false);
        } else {
          prompts.note('Found saved images for this release. Verifying their immutable digests and source labels.');
        }

        return artifacts;
      },
      verify: async images => {
        for (const [image, repository] of [
          [images.runtime, settings.TCG_IMAGE_REPOSITORY],
          [images.migration, `${settings.TCG_IMAGE_REPOSITORY}-migrations`],
        ]) {
          if (!image?.startsWith(`${repository}@sha256:`)) {
            throw new InfraFailure('Saved images do not belong to the configured registry. Start a fresh release.');
          }

          await command('docker', ['pull', '--platform', 'linux/amd64', image]);

          const [inspected] = z
            .tuple([ToolchainSchema])
            .parse(JSON.parse(await command('docker', ['image', 'inspect', image])));

          if (inspected.Config.Labels['org.opencontainers.image.revision'] !== sha) {
            throw new InfraFailure('An image source label differs from the selected release. Deployment was stopped.');
          }
        }
      },
      migrations: async image => migrationStatus(await remote(`migration-status ${image}`)),
      migrate: async (image, reviewed) => {
        prompts.note('Applying the approved database migrations.', '4. Migrations');
        await remote(`migrate-checked ${image} ${reviewed}`);
      },
      deploy: async (images, reviewed) => {
        prompts.note('Deploying and checking application health.', '5. Deploy');
        await remote(
          `release-checked ${images.runtime} ${images.migration} ${reviewed.hostname ? 'public' : 'private'} false ${reviewed.fingerprint}`,
        );
      },
      check: async () => {
        await remote('check');
      },
      complete: async () => {
        await checkpoint(true);
      },
    });
  } finally {
    if (worktreeAdded) {
      // Only this invocation's isolated checkout is removed; logs and checkpoints remain private.
      await gitRemoveWorktree((program, args) => execute(program, args, { cwd: root }), {
        path: opsRoot,
        force: true,
      }).catch(() => undefined);
    }
  }
}

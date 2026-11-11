import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Conflict, NotFound } from '@tcg/http/exceptions';

import {
  ReleaseSchema,
  type Decision,
  type Release,
  type ServerStatus,
  type Start,
  type AppStatus,
  type AppStart,
} from './contracts.ts';
import { APP_ALREADY_UPLOADED, type Platform } from '../../scripts/app-release/config.ts';
import type { AppRuntimeOptions } from '../../scripts/app-release/runtime.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';
import type { Prompts } from '../../scripts/infra/prompts.ts';
import { acquireLocalLease, acquireReleaseLock } from '../../scripts/release/lock.ts';
import type { RuntimeOptions } from '../../scripts/release/runtime.ts';
import { PORTAL_SETUP_REQUIRED } from '../../scripts/release/server-setup.ts';

interface Dependencies {
  directory: string;
  configDirectory: string;
  transitioned?: (release: Release) => void;
  inspect(page: number): Promise<ServerStatus>;
  inspectApp?: (platform: Platform, page: number) => Promise<AppStatus>;
  runApp?: (
    options: Pick<AppRuntimeOptions, 'platform' | 'revision' | 'prompts' | 'stage' | 'reviewedFingerprint'>,
  ) => Promise<void>;
  run: (options: Pick<RuntimeOptions, 'revision' | 'prompts' | 'stage' | 'reviewedFingerprint'>) => Promise<void>;
}

interface Pending {
  id: string;
  resolve(value: boolean): void;
}

/** Owns all mutation; every transition is durable before it becomes observable. */
export class ReleaseSessions {
  private readonly releases = new Map<string, Release>();
  private shuttingDown = false;
  private appWork: Promise<void> | undefined;
  private pending: Pending | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  private readonly dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dependencies.directory, { recursive: true, mode: 0o700 });

    for (const name of await fs.readdir(this.dependencies.directory)) {
      if (!name.endsWith('.json')) {
        continue;
      }

      const release = ReleaseSchema.parse(
        JSON.parse(await fs.readFile(path.join(this.dependencies.directory, name), 'utf8')),
      );

      const recovered: Release =
        release.state === 'running' || release.state === 'approval'
          ? {
              ...release,
              state: 'interrupted',
              approval: null,
              failure:
                release.target === 'server'
                  ? 'Release interrupted. Retry to verify live state and saved images.'
                  : 'App release interrupted. Check App Store Connect before retrying; the upload may have completed.',
            }
          : release;

      await this.save(recovered);
    }
  }

  private async save(release: Release): Promise<void> {
    const file = path.join(this.dependencies.directory, `${release.id}.json`);
    const temporary = `${file}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(release), { mode: 0o600 });
    await fs.rename(temporary, file);
    const previous = this.releases.get(release.id);
    this.releases.set(release.id, release);

    if (
      !previous ||
      previous.state !== release.state ||
      previous.stage !== release.stage ||
      previous.decisions.length !== release.decisions.length
    ) {
      this.dependencies.transitioned?.(release);
    }
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.then(work);
    this.queue = task.catch(() => undefined);

    return task;
  }

  get(id: string): Release {
    const release = this.releases.get(id);

    if (!release) {
      throw new NotFound(undefined);
    }

    return structuredClone(release);
  }

  async status(page: number): Promise<ServerStatus> {
    const server = await this.dependencies.inspect(page);

    const active = [...this.releases.values()].find(
      release => release.target === 'server' && (release.state === 'running' || release.state === 'approval'),
    );

    const latest = this.latest('server');

    return { ...server, activeRelease: active?.id ?? null, latestRelease: latest?.id ?? null };
  }

  private latest(target: Release['target']): Release | undefined {
    return [...this.releases.values()]
      .filter(release => release.target === target)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  async appStatus(platform: Platform, page: number): Promise<AppStatus> {
    if (!this.dependencies.inspectApp) {
      throw new InfraFailure('App releases require an updated service.');
    }

    const status = await this.dependencies.inspectApp(platform, page);

    const active = [...this.releases.values()].find(
      release => release.target === platform && (release.state === 'running' || release.state === 'approval'),
    );

    const latest = this.latest(platform);

    return {
      ...status,
      activeRelease: active?.id ?? null,
      latestRelease: latest?.id ?? null,
      blocker:
        status.blocker ??
        (latest?.state === 'succeeded' && latest.fingerprint === status.fingerprint ? APP_ALREADY_UPLOADED : null),
    };
  }

  startApp(input: AppStart, operator: string): Promise<Release> {
    return this.startTarget(input, operator, input.platform);
  }

  start(input: Start, operator: string): Promise<Release> {
    return this.startTarget(input, operator, 'server');
  }

  private startTarget(input: Start, operator: string, target: Release['target']): Promise<Release> {
    return this.serialize(async () => {
      const duplicate = [...this.releases.values()].find(release => release.requestId === input.requestId);

      if (duplicate) {
        if (duplicate.sha !== input.sha || duplicate.fingerprint !== input.fingerprint || duplicate.target !== target) {
          throw new Conflict({
            code: 'REQUEST_CONFLICT',
            message: 'Request ID was already used with different input.',
          });
        }

        return structuredClone(duplicate);
      }

      if ([...this.releases.values()].some(release => release.state === 'running' || release.state === 'approval')) {
        throw new Conflict({ code: 'RELEASE_BUSY', message: 'Another release is active.' });
      }

      const unlock =
        target === 'server'
          ? await acquireReleaseLock(this.dependencies.configDirectory)
          : await acquireLocalLease(this.dependencies.configDirectory, 'app-release');

      try {
        let status: ServerStatus;
        let currentFingerprint: string | null | undefined;

        if (target === 'server') {
          status = await this.dependencies.inspect(0);
          currentFingerprint = status.host?.fingerprint;
        } else {
          const app = await this.appStatus(target, 0);
          status = app;
          currentFingerprint = app.fingerprint;
        }

        if (status.main !== input.sha || currentFingerprint !== input.fingerprint) {
          throw new Conflict({
            code: 'REVIEW_STALE',
            message: 'The release target changed. Refresh and review again.',
          });
        }

        const latest = this.latest(target);
        const retryable = latest?.sha === input.sha && (latest.state === 'failed' || latest.state === 'interrupted');

        if (status.blocker || (target === 'server' && status.pending === 0 && !retryable)) {
          throw new Conflict({ code: 'RELEASE_BLOCKED', message: status.blocker ?? 'The server is up to date.' });
        }

        const release: Release = {
          id: crypto.randomUUID(),
          ...input,
          target,
          operator,
          createdAt: new Date().toISOString(),
          state: 'running',
          stage: target === 'server' ? 'build' : 'checks',
          approval: null,
          events: [],
          decisions: [],
          failure: null,
        };

        await this.save(release);
        // Start outside the HTTP lifetime. execute owns the lease until every command finishes.
        const work = this.execute(release.id, unlock);

        if (target !== 'server') {
          this.appWork = work;
        }

        void work;

        return structuredClone(release);
      } catch (error) {
        await unlock();
        throw error;
      }
    });
  }

  decide(id: string, approvalId: string, input: Decision, operator: string): Promise<Release> {
    return this.serialize(async () => {
      const release = this.get(id);
      const duplicate = release.decisions.find(decision => decision.requestId === input.requestId);

      if (duplicate) {
        if (duplicate.approvalId !== approvalId || duplicate.approved !== input.approved) {
          throw new Conflict({
            code: 'REQUEST_CONFLICT',
            message: 'Request ID was already used with different input.',
          });
        }

        return release;
      }

      if (!release.approval || release.approval.id !== approvalId || this.pending?.id !== approvalId) {
        throw new Conflict({
          code: 'APPROVAL_RESOLVED',
          message: 'This approval is no longer pending. Refresh the release.',
        });
      }

      const next: Release = {
        ...release,
        state: 'running',
        approval: null,
        decisions: [...release.decisions, { ...input, operator, approvalId }],
      };

      await this.save(next);
      const pending = this.pending;
      this.pending = undefined;
      pending.resolve(input.approved);

      return next;
    });
  }

  async shutdownApp(): Promise<void> {
    this.shuttingDown = true;

    const active = [...this.releases.values()].find(
      release => release.target !== 'server' && (release.state === 'running' || release.state === 'approval'),
    );

    if (active && this.pending) {
      this.pending.resolve(false);
    }

    await this.appWork;
  }

  private async execute(id: string, unlock: () => Promise<void>): Promise<void> {
    const update = (transform: (release: Release) => Release) => {
      return this.serialize(() => this.save(transform(this.get(id))));
    };

    const unsupported = async (): Promise<never> => {
      throw new InfraFailure('This action requires just release-server on the Mac mini.');
    };

    const prompts: Prompts = {
      text: unsupported,
      password: unsupported,
      select: unsupported,
      multiselect: unsupported,
      note: message => {
        void update(release => ({
          ...release,
          events: [
            ...release.events.slice(-199),
            { message: safeNote(message), stage: release.stage, at: new Date().toISOString() },
          ],
        }));
      },
      confirm: async (message, _initial, context) => {
        if (this.shuttingDown && this.get(id).target !== 'server') {
          throw new InfraFailure('App release interrupted. Check App Store Connect before retrying.');
        }

        const kind = context?.kind;

        if (kind !== 'migrations' && kind !== 'deploy' && kind !== 'provision' && kind !== 'upload') {
          return unsupported();
        }

        const approval = {
          id: crypto.randomUUID(),
          kind,
          message,
          review: context?.review ?? null,
          appReview: context?.appReview,
        };

        return new Promise<boolean>((resolve, reject) => {
          void update(release => ({ ...release, state: 'approval', approval })).then(() => {
            this.pending = { id: approval.id, resolve };
          }, reject);
        });
      },
    };

    try {
      const release = this.get(id);

      const stage = (stage: Release['stage']) => {
        void update(current => ({ ...current, stage }));
      };

      if (release.target !== 'server') {
        if (!this.dependencies.runApp) {
          throw new InfraFailure('App releases require an updated service.');
        }

        await this.dependencies.runApp({
          platform: release.target,
          revision: release.sha,
          reviewedFingerprint: release.fingerprint,
          prompts,
          stage,
        });
      } else {
        await this.dependencies.run({
          revision: release.sha,
          reviewedFingerprint: release.fingerprint,
          prompts,
          stage,
        });
      }

      await update(release => ({
        ...release,
        state: 'succeeded',
        stage: release.target === 'server' ? 'verify' : 'upload',
        approval: null,
      }));
    } catch (error) {
      const current = this.get(id);

      let failure =
        'Release stopped. Check setup and the private release log on the Mac mini, then retry. Completed images can be reused.';

      if (current.target !== 'server') {
        failure =
          'App release stopped. Check Xcode setup and the private log on the release Mac. If upload started, check App Store Connect before retrying.';
      } else if (error instanceof InfraFailure && error.message === PORTAL_SETUP_REQUIRED) {
        failure = PORTAL_SETUP_REQUIRED;
      }

      await update(release => ({
        ...release,
        state: this.shuttingDown && release.target !== 'server' ? 'interrupted' : 'failed',
        approval: null,
        failure,
      }));
    } finally {
      this.pending = undefined;
      await unlock();
    }
  }
}

function safeNote(message: string): string {
  // Pipeline notes are curated. Runtime notes containing local paths stay on the host.
  if (/\/|credential|token|password/i.test(message)) {
    return 'See the private release log on the Mac mini for details.';
  }

  return message;
}

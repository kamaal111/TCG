import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Conflict, NotFound } from '@tcg/http/exceptions';

import { ReleaseSchema, type Decision, type Release, type ServerStatus, type Start } from './contracts.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';
import type { Prompts } from '../../scripts/infra/prompts.ts';
import { acquireReleaseLock } from '../../scripts/release/lock.ts';
import type { RuntimeOptions } from '../../scripts/release/runtime.ts';
import { PORTAL_SETUP_REQUIRED } from '../../scripts/release/server-setup.ts';

interface Dependencies {
  directory: string;
  configDirectory: string;
  transitioned?: (release: Release) => void;
  inspect(page: number): Promise<ServerStatus>;
  run: (options: Pick<RuntimeOptions, 'revision' | 'prompts' | 'stage' | 'reviewedFingerprint'>) => Promise<void>;
}

interface Pending {
  id: string;
  resolve(value: boolean): void;
}

/** Owns all mutation; every transition is durable before it becomes observable. */
export class ReleaseSessions {
  private readonly releases = new Map<string, Release>();
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
              failure: 'Release interrupted. Retry to verify live state and saved images.',
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
      release => release.state === 'running' || release.state === 'approval',
    );

    const latest = this.latest();

    return { ...server, activeRelease: active?.id ?? null, latestRelease: latest?.id ?? null };
  }

  private latest(): Release | undefined {
    return [...this.releases.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  start(input: Start, operator: string): Promise<Release> {
    return this.serialize(async () => {
      const duplicate = [...this.releases.values()].find(release => release.requestId === input.requestId);

      if (duplicate) {
        if (duplicate.sha !== input.sha || duplicate.fingerprint !== input.fingerprint) {
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

      const unlock = await acquireReleaseLock(this.dependencies.configDirectory);

      try {
        const status = await this.dependencies.inspect(0);

        if (status.main !== input.sha || status.host?.fingerprint !== input.fingerprint) {
          throw new Conflict({
            code: 'REVIEW_STALE',
            message: 'The release target changed. Refresh and review again.',
          });
        }

        const latest = this.latest();
        const retryable = latest?.sha === input.sha && (latest.state === 'failed' || latest.state === 'interrupted');

        if (status.blocker || (status.pending === 0 && !retryable)) {
          throw new Conflict({ code: 'RELEASE_BLOCKED', message: status.blocker ?? 'The server is up to date.' });
        }

        const release: Release = {
          id: crypto.randomUUID(),
          ...input,
          operator,
          createdAt: new Date().toISOString(),
          state: 'running',
          stage: 'build',
          approval: null,
          events: [],
          decisions: [],
          failure: null,
        };

        await this.save(release);
        // Start outside the HTTP lifetime. execute owns the lease until every command finishes.
        void this.execute(release.id, unlock);

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
        const kind = context?.kind;

        if (kind !== 'migrations' && kind !== 'deploy') {
          return unsupported();
        }

        const approval = { id: crypto.randomUUID(), kind, message, review: context?.review ?? null };

        return new Promise<boolean>((resolve, reject) => {
          void update(release => ({ ...release, state: 'approval', approval })).then(() => {
            this.pending = { id: approval.id, resolve };
          }, reject);
        });
      },
    };

    try {
      const release = this.get(id);
      await this.dependencies.run({
        revision: release.sha,
        reviewedFingerprint: release.fingerprint,
        prompts,
        stage: stage => {
          void update(current => ({ ...current, stage }));
        },
      });
      await update(release => ({ ...release, state: 'succeeded', stage: 'verify', approval: null }));
    } catch (error) {
      await update(release => ({
        ...release,
        state: 'failed',
        approval: null,
        failure:
          error instanceof InfraFailure && error.message === PORTAL_SETUP_REQUIRED
            ? PORTAL_SETUP_REQUIRED
            : 'Release stopped. Check setup and the private release log on the Mac mini, then retry. Completed images can be reused.',
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

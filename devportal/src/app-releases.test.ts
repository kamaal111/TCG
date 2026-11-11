import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { configureLogging } from '@tcg/http/logging';
import { createNodeLogger } from '@tcg/http/node-logging';
import type { TestContext } from 'vitest';

import { createDevportalApp } from './app.ts';
import { AppStatusSchema, ReleaseSchema } from './contracts.ts';
import { ReleaseSessions } from './sessions.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';
import { acquireAllReleaseLocks } from '../../scripts/release/lock.ts';

const sha = 'a'.repeat(40);
const fingerprint = 'b'.repeat(64);
const operator = 'operator@example.com';

const status = AppStatusSchema.parse({
  target: 'Mintomo iOS',
  main: sha,
  host: null,
  pending: 1,
  commits: [],
  nextPage: null,
  blocker: null,
  activeRelease: null,
  latestRelease: null,
  platform: 'ios',
  fingerprint,
  version: '1.0',
  teamID: 'DXUKH9VF73',
  apiHost: 'api.mintomo.com',
  uploaded: null,
});

async function fixture(t: TestContext) {
  const logger = createNodeLogger({ service: 'app-release-test', mode: 'TEST', level: 'silent' });
  configureLogging({ root: logger, createRequestLogger: fields => logger.child(fields) });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-app-'));
  t.onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));

  const inspectApp = vi.fn<NonNullable<ConstructorParameters<typeof ReleaseSessions>[0]['inspectApp']>>(
    async platform => ({ ...status, platform }),
  );

  const upload = vi.fn<() => void>();

  const runApp = vi.fn<NonNullable<ConstructorParameters<typeof ReleaseSessions>[0]['runApp']>>(async options => {
    options.stage?.('archive');

    if (!(await options.prompts.confirm('Provision?', false, { kind: 'provision' }))) {
      throw new InfraFailure('Declined');
    }

    options.stage?.('upload');

    if (!(await options.prompts.confirm('Upload?', false, { kind: 'upload' }))) {
      throw new InfraFailure('Declined');
    }

    upload();
  });

  const dependencies = {
    directory: path.join(directory, 'sessions'),
    configDirectory: directory,
    inspect: vi.fn<ConstructorParameters<typeof ReleaseSessions>[0]['inspect']>(),
    run: vi.fn<ConstructorParameters<typeof ReleaseSessions>[0]['run']>(),
    inspectApp,
    runApp,
  };

  const sessions = new ReleaseSessions(dependencies);
  await sessions.initialize();
  const app = createDevportalApp(sessions, [operator]);

  const request = (route: string, body?: Record<string, string | boolean>, identity: string = operator) => {
    return app.request(route, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'Tailscale-User-Login': identity },
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  const input = { platform: 'ios', sha, fingerprint, requestId: crypto.randomUUID() };

  return { directory, dependencies, sessions, request, input, inspectApp, runApp, upload };
}

test('app routes reject missing and disallowed identities and invalid platforms', async t => {
  const f = await fixture(t);
  expect((await f.request('/v1/apps/ios', undefined, '')).status).toBe(401);
  expect((await f.request('/v1/apps/macos', undefined, 'stranger@example.com')).status).toBe(403);
  expect((await f.request('/v1/apps/watchos')).status).toBe(400);
  expect(f.inspectApp).not.toHaveBeenCalled();
  expect(f.runApp).not.toHaveBeenCalled();
});

test('runs both app approval stages once, reconnects and keeps platform history separate', async t => {
  const f = await fixture(t);
  const release = ReleaseSchema.parse(await (await f.request('/v1/app-releases', f.input)).json());
  await vi.waitFor(() => expect(f.sessions.get(release.id).approval?.kind).toBe('provision'));
  expect((await f.request('/v1/app-releases', f.input)).status).toBe(202);
  expect((await f.request('/v1/app-releases', { ...f.input, platform: 'macos' })).status).toBe(409);
  expect(f.runApp).toHaveBeenCalledOnce();
  const recovered = ReleaseSchema.parse(await (await f.request(`/v1/releases/${release.id}`)).json());
  const provision = recovered.approval;
  expect(provision).not.toBeNull();
  const decision = { approved: true, requestId: crypto.randomUUID() };
  expect((await f.request(`/v1/releases/${release.id}/approvals/${provision?.id}`, decision)).status).toBe(200);
  expect((await f.request(`/v1/releases/${release.id}/approvals/${provision?.id}`, decision)).status).toBe(200);
  await vi.waitFor(() => expect(f.sessions.get(release.id).approval?.kind).toBe('upload'));
  expect(f.upload).not.toHaveBeenCalled();
  await expect(acquireAllReleaseLocks(f.directory)).rejects.toThrow('Another app-release');
  const uploadApproval = f.sessions.get(release.id).approval;
  await f.request(`/v1/releases/${release.id}/approvals/${uploadApproval?.id}`, {
    approved: true,
    requestId: crypto.randomUUID(),
  });
  await vi.waitFor(() => expect(f.sessions.get(release.id).state).toBe('succeeded'));
  expect(f.upload).toHaveBeenCalledOnce();
  expect((await f.sessions.appStatus('ios', 0)).latestRelease).toBe(release.id);
  expect((await f.sessions.appStatus('macos', 0)).latestRelease).toBeNull();
  expect((await f.request('/v1/app-releases', { ...f.input, requestId: crypto.randomUUID() })).status).toBe(409);
  const restored = new ReleaseSessions(f.dependencies);
  await restored.initialize();
  expect(restored.get(release.id).target).toBe('ios');
  expect(restored.get(release.id).decisions).toHaveLength(2);
});

test('stale review and setup blockers stop before starting work', async t => {
  const f = await fixture(t);
  expect((await f.request('/v1/app-releases', { ...f.input, fingerprint: 'c'.repeat(64) })).status).toBe(409);
  f.inspectApp.mockResolvedValue({ ...status, blocker: 'Run just setup-app-release on the release Mac.' });
  expect((await f.request('/v1/app-releases', f.input)).status).toBe(409);
  expect(f.runApp).not.toHaveBeenCalled();
});

test('service restart interrupts an app release without retrying an upload', async t => {
  const f = await fixture(t);
  const release = ReleaseSchema.parse(await (await f.request('/v1/app-releases', f.input)).json());
  await vi.waitFor(() => expect(f.sessions.get(release.id).state).toBe('approval'));
  const restored = new ReleaseSessions(f.dependencies);
  await restored.initialize();
  expect(restored.get(release.id)).toMatchObject({ state: 'interrupted', approval: null });
  expect(restored.get(release.id).failure).toContain('upload may have completed');
  expect(f.upload).not.toHaveBeenCalled();
  const approval = f.sessions.get(release.id).approval;
  await f.request(`/v1/releases/${release.id}/approvals/${approval?.id}`, {
    approved: false,
    requestId: crypto.randomUUID(),
  });
  await vi.waitFor(() => expect(f.sessions.get(release.id).state).toBe('failed'));
});

test('graceful service shutdown declines pending app approval and retains an interrupted session', async t => {
  const f = await fixture(t);
  const release = ReleaseSchema.parse(await (await f.request('/v1/app-releases', f.input)).json());
  await vi.waitFor(() => expect(f.sessions.get(release.id).approval?.kind).toBe('provision'));
  await f.sessions.shutdownApp();
  expect(f.sessions.get(release.id).state).toBe('interrupted');
  expect(f.upload).not.toHaveBeenCalled();
  await expect(fs.access(path.join(f.directory, 'app-release.lock'))).rejects.toThrow('ENOENT');
});

test('reports source preparation failures before signing or upload', async t => {
  const f = await fixture(t);
  f.runApp.mockRejectedValueOnce(new InfraFailure('private diagnostic at /private/release.log'));
  const release = ReleaseSchema.parse(await (await f.request('/v1/app-releases', f.input)).json());
  await vi.waitFor(() => expect(f.sessions.get(release.id).state).toBe('failed'));
  expect(f.sessions.get(release.id).failure).toContain('source preparation failed before signing or upload');
  expect(f.sessions.get(release.id).failure).not.toContain('/private/release.log');
  expect(f.upload).not.toHaveBeenCalled();
});

test('persists live app milestones and elapsed updates while keeping host output private', async t => {
  const f = await fixture(t);
  const work = Promise.withResolvers<boolean>();
  f.runApp.mockImplementationOnce(async options => {
    options.prompts.note('Starting: Preparing isolated release source.');
    options.prompts.note('Preparing isolated release source: 1m 30s elapsed.');
    options.prompts.note('Private output at /private/release.log');
    await work.promise;
    options.prompts.note('Completed: Preparing isolated release source (1m 30s).');
  });
  t.onTestFinished(async () => {
    work.resolve(true);
    await f.sessions.shutdownApp();
  });
  const release = ReleaseSchema.parse(await (await f.request('/v1/app-releases', f.input)).json());
  await vi.waitFor(() => expect(f.sessions.get(release.id).events).toHaveLength(3));
  expect(f.sessions.get(release.id).state).toBe('running');
  expect(f.sessions.get(release.id).events.map(event => event.message)).toEqual([
    'Starting: Preparing isolated release source.',
    'Preparing isolated release source: 1m 30s elapsed.',
    'See the private release log on the Mac mini for details.',
  ]);
  work.resolve(true);
  await vi.waitFor(() => expect(f.sessions.get(release.id).state).toBe('succeeded'));
  const restored = new ReleaseSessions(f.dependencies);
  await restored.initialize();
  expect(restored.get(release.id).events.at(-1)?.message).toBe(
    'Completed: Preparing isolated release source (1m 30s).',
  );
});

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { configureLogging } from '@tcg/http/logging';
import { createNodeLogger } from '@tcg/http/node-logging';

import { createDevportalApp } from './app.ts';
import { ReleaseSchema, ServerSchema, type ServerStatus } from './contracts.ts';
import { ReleaseSessions } from './sessions.ts';
import { webRoot } from './web.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';

const sha = 'a'.repeat(40);
const fingerprint = 'b'.repeat(64);
const operator = 'operator@example.com';

const server: ServerStatus = {
  target: 'production',
  main: sha,
  host: {
    protocol: 1,
    busy: false,
    hostname: '',
    repository: 'ghcr.io/example/server',
    runtime: null,
    revision: null,
    operationsRevision: sha,
    fingerprint,
  },
  pending: 1,
  commits: [{ sha, subject: 'Release change', author: 'Developer', date: '2026-11-10T12:00:00Z', area: 'server' }],
  nextPage: null,
  blocker: null,
  activeRelease: null,
  latestRelease: null,
};

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mintomo portal-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  vi.stubEnv('MODE', 'TEST');
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const logger = createNodeLogger({ service: 'devportal-test', mode: 'TEST', level: 'silent' });
  configureLogging({ root: logger, createRequestLogger: fields => logger.child(fields) });
  const inspect = vi.fn<(page: number) => Promise<ServerStatus>>().mockResolvedValue(server);
  const migrate = vi.fn<() => void>();
  const deploy = vi.fn<() => void>();

  const run = vi.fn<ConstructorParameters<typeof ReleaseSessions>[0]['run']>().mockImplementation(async options => {
    options.stage?.('migrations');

    if (!(await options.prompts.confirm('Apply 1 database migration?', false, { kind: 'migrations' }))) {
      return;
    }

    migrate();
    options.stage?.('deploy');

    if (!(await options.prompts.confirm('Deploy this release?', false, { kind: 'deploy' }))) {
      return;
    }

    deploy();
    options.stage?.('verify');
  });

  const dependencies = { directory: path.join(directory, 'releases'), configDirectory: directory, inspect, run };
  const sessions = new ReleaseSessions(dependencies);
  await sessions.initialize();
  const app = createDevportalApp(sessions, [operator], webRoot);

  const request = (route: string, body?: Record<string, string | boolean>, identity: string | null = operator) => {
    const headers = new Headers({ 'Content-Type': 'application/json' });

    if (identity) {
      headers.set('Tailscale-User-Login', identity);
    }

    return app.request(route, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  const start = { sha, fingerprint, requestId: crypto.randomUUID() };

  return { app, request, sessions, start, run, migrate, deploy, dependencies, inspect };
}

test('authorizes every route before inspecting or exposing release data', async () => {
  const f = await fixture();
  expect((await f.request('/v1/server', undefined, null)).status).toBe(401);
  const denied = await f.request('/v1/server', undefined, 'outsider@example.com');
  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual({ code: 'FORBIDDEN', message: 'Forbidden' });
  expect(f.inspect).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});

test('returns validated pending commits and rejects invalid requests', async () => {
  const f = await fixture();
  expect(ServerSchema.parse(await (await f.request('/v1/server')).json())).toEqual(server);
  expect((await f.request('/v1/server?page=-1')).status).toBe(400);
  expect((await f.request('/v1/releases', { ...f.start, sha: 'bad' })).status).toBe(400);
  expect((await f.request('/v1/releases/not-a-uuid')).status).toBe(400);
  expect(f.run).not.toHaveBeenCalled();
});

test('rejects stale reviews, blocked targets and already deployed commits', async () => {
  const f = await fixture();
  const stale = await f.request('/v1/releases', { ...f.start, fingerprint: 'c'.repeat(64) });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'REVIEW_STALE' });
  f.inspect.mockResolvedValue({ ...server, blocker: 'Server setup is required.' });
  expect((await f.request('/v1/releases', f.start)).status).toBe(409);
  f.inspect.mockResolvedValue({ ...server, pending: 0 });
  expect((await f.request('/v1/releases', f.start)).status).toBe(409);
  expect(f.run).not.toHaveBeenCalled();
});

test('persists stages across client reconnection and applies each approval once', async () => {
  const f = await fixture();
  const started = await f.request('/v1/releases', f.start);
  expect(started.status).toBe(202);
  const release = ReleaseSchema.parse(await started.json());
  await vi.waitFor(() => expect(f.sessions.get(release.id).approval?.kind).toBe('migrations'));
  expect(f.migrate).not.toHaveBeenCalled();
  expect(f.deploy).not.toHaveBeenCalled();
  const resumed = ReleaseSchema.parse(await (await f.request(`/v1/releases/${release.id}`)).json());
  const migrationApproval = resumed.approval;
  expect(migrationApproval).not.toBeNull();
  const decision = { approved: true, requestId: crypto.randomUUID() };
  expect((await f.request(`/v1/releases/${release.id}/approvals/${migrationApproval?.id}`, decision)).status).toBe(200);
  expect((await f.request(`/v1/releases/${release.id}/approvals/${migrationApproval?.id}`, decision)).status).toBe(200);
  await vi.waitFor(() => expect(f.sessions.get(release.id).approval?.kind).toBe('deploy'));
  expect(f.migrate).toHaveBeenCalledOnce();
  expect(f.deploy).not.toHaveBeenCalled();
  expect((await f.request('/v1/releases', { ...f.start, requestId: crypto.randomUUID() })).status).toBe(409);
  expect((await f.request('/v1/releases', f.start)).status).toBe(202);
  expect(f.run).toHaveBeenCalledOnce();
  const approval = f.sessions.get(release.id).approval;
  await f.request(`/v1/releases/${release.id}/approvals/${approval?.id}`, {
    approved: true,
    requestId: crypto.randomUUID(),
  });
  await vi.waitFor(() => expect(f.sessions.get(release.id).state).toBe('succeeded'));
  expect(f.deploy).toHaveBeenCalledOnce();
  const recovered = new ReleaseSessions(f.dependencies);
  await recovered.initialize();
  expect(recovered.get(release.id).decisions.map(item => item.operator)).toEqual([operator, operator]);
});

test('marks unfinished persisted sessions interrupted without automatically running work', async () => {
  const f = await fixture();
  const started = ReleaseSchema.parse(await (await f.request('/v1/releases', f.start)).json());
  await vi.waitFor(() => expect(f.sessions.get(started.id).state).toBe('approval'));
  const recovered = new ReleaseSessions(f.dependencies);
  await recovered.initialize();
  expect(recovered.get(started.id)).toMatchObject({ state: 'interrupted', approval: null });
  expect(f.run).toHaveBeenCalledOnce();
  // Finish the original in-process fixture so its lease is released before cleanup.
  const approval = f.sessions.get(started.id).approval;
  await f.request(`/v1/releases/${started.id}/approvals/${approval?.id}`, {
    approved: false,
    requestId: crypto.randomUUID(),
  });
  await vi.waitFor(() => expect(f.sessions.get(started.id).state).toBe('succeeded'));
});

test('rejects browser-origin writes and oversized requests before release work', async () => {
  const f = await fixture();

  const browser = await f.app.request('/v1/releases', {
    method: 'POST',
    headers: {
      'Tailscale-User-Login': operator,
      Origin: 'https://untrusted.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(f.start),
  });

  expect(browser.status).toBe(403);
  const large = await f.request('/v1/releases', { ...f.start, padding: 'x'.repeat(20000) });
  expect(large.status).toBe(413);
  expect(f.run).not.toHaveBeenCalled();
});

test('a failed health check can be retried after the selected commit is already deployed', async () => {
  const f = await fixture();
  f.run.mockRejectedValueOnce(new InfraFailure('Health check failed.'));
  const original = ReleaseSchema.parse(await (await f.request('/v1/releases', f.start)).json());
  await vi.waitFor(() => expect(f.sessions.get(original.id).state).toBe('failed'));
  f.inspect.mockResolvedValue({ ...server, pending: 0, commits: [] });
  f.run.mockResolvedValue(undefined);
  const retry = { ...f.start, requestId: crypto.randomUUID() };
  await vi.waitFor(async () => {
    expect((await f.request('/v1/releases', retry)).status).toBe(202);
  });
  expect(f.run).toHaveBeenCalledTimes(2);
});

test('serves the built portal and its assets to an allowed Tailscale user', async () => {
  const f = await fixture();
  const html = await f.request('/');
  expect(html.status).toBe(200);
  expect(html.headers.get('cache-control')).toBe('no-store');
  expect(html.headers.get('content-security-policy')).toContain("script-src 'self'");
  const source = await html.text();
  expect(source).toContain('<title>Mintomo Devportal</title>');
  const script = source.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  expect(script).toBeDefined();
  const style = source.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
  expect(style).toBeDefined();
  const css = await f.request(String(style));
  expect(css.status).toBe(200);
  expect(css.headers.get('content-type')).toContain('text/css');
  await css.text();
  const asset = await f.request(String(script));
  expect(asset.status).toBe(200);
  expect(asset.headers.get('content-type')).toContain('javascript');
  expect(await asset.text()).not.toContain('node:child_process');
  expect((await f.request('/assets/missing.js')).status).toBe(404);
  const unknownApi = await f.request('/v1/missing');
  expect(unknownApi.status).toBe(404);
  expect(unknownApi.headers.get('content-type')).toContain('application/json');
});

test.each([
  ['/', null, 401],
  ['/assets/portal.js', null, 401],
  ['/', 'unlisted@example.com', 403],
  ['/assets/portal.js', 'unlisted@example.com', 403],
] as const)('rejects access to %s with identity %s', async (route, login, status) => {
  const f = await fixture();
  expect((await f.request(route, undefined, login)).status).toBe(status);
});

const serveHost = 'release.example.ts.net:8443';

test.each([
  ['https://other.example.ts.net:8443', 'https'],
  ['https://release.example.ts.net', 'https'],
  ['null', 'https'],
  ['https://release.example.ts.net:8443', 'http'],
])('rejects a browser write from %s with forwarded protocol %s', async (origin, protocol) => {
  const f = await fixture();

  const response = await f.app.request('/v1/releases', {
    method: 'POST',
    headers: {
      Host: serveHost,
      'X-Forwarded-Proto': protocol,
      'Tailscale-User-Login': operator,
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify(f.start),
  });

  expect(response.status).toBe(403);
  expect(f.run).not.toHaveBeenCalled();
});

test('starts and answers approval from the same private Serve HTTPS origin', async () => {
  const f = await fixture();

  const headers = {
    Host: serveHost,
    'X-Forwarded-Proto': 'https',
    'Tailscale-User-Login': operator,
    'Content-Type': 'application/json',
    Origin: `https://${serveHost}`,
  };

  const started = await f.app.request('/v1/releases', { method: 'POST', headers, body: JSON.stringify(f.start) });
  expect(started.status).toBe(202);
  const { id } = ReleaseSchema.parse(await started.json());

  const approval = await vi.waitFor(() => {
    const { approval } = f.sessions.get(id);
    expect(approval?.kind).toBe('migrations');

    return approval;
  });

  const response = await f.app.request(`/v1/releases/${id}/approvals/${approval?.id}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ approved: false, requestId: crypto.randomUUID() }),
  });

  expect(response.status).toBe(200);
  await vi.waitFor(() => expect(f.sessions.get(id).state).not.toBe('running'));
  expect(f.migrate).not.toHaveBeenCalled();
});

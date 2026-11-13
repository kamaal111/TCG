// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Portal } from './portal.tsx';
import type { AppStatus, Release, ServerStatus } from '../../../server/devportal/contracts.ts';

const sha = 'a'.repeat(40);
const fingerprint = 'b'.repeat(64);
const id = '17e4760d-96ed-4f4e-9eab-b18bec030499';
const approvalId = '594cb9b5-a8a0-4608-8a76-3304175e6bad';

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
  commits: [{ sha, subject: 'Review this commit', author: 'Developer', date: '2026-11-10' }],
  nextPage: null,
  blocker: null,
  activeRelease: null,
  latestRelease: null,
};

const release: Release = {
  id,
  target: 'server',
  sha,
  fingerprint,
  requestId: id,
  operator: 'operator@example.com',
  createdAt: '2026-11-10T12:00:00Z',
  state: 'running',
  stage: 'build',
  approval: null,
  events: [],
  decisions: [],
  failure: null,
};

function mockFetch() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal('fetch', fetch);

  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('reviews server, iOS, and macOS from their respective API routes', async () => {
  const fetch = mockFetch();

  const ios: AppStatus = {
    ...server,
    target: 'iOS upload',
    platform: 'ios',
    version: '1.2.3',
    teamID: 'TEAM',
    apiHost: 'api.example.com',
    uploaded: null,
    fingerprint,
  };

  const mac: AppStatus = { ...ios, target: 'macOS upload', platform: 'macos' };
  fetch
    .mockResolvedValueOnce(Response.json(server))
    .mockResolvedValueOnce(Response.json(ios))
    .mockResolvedValueOnce(Response.json(mac));

  render(<Portal />);
  expect(await screen.findByText('production')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'iOS' }));
  expect(await screen.findByText('iOS upload')).toBeDefined();
  expect(screen.getByText('1.2.3')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'macOS' }));
  expect(await screen.findByText('macOS upload')).toBeDefined();
  expect(fetch.mock.calls.map(([route]) => route)).toEqual([
    '/v1/server?page=0',
    '/v1/apps/ios?page=0',
    '/v1/apps/macos?page=0',
  ]);
});

test('reloads the first page when a later page has a different fingerprint', async () => {
  const fetch = mockFetch();

  const refreshed = {
    ...server,
    host: { ...server.host, fingerprint: 'c'.repeat(64) },
    commits: [{ ...server.commits[0], subject: 'New review' }],
  };

  fetch
    .mockResolvedValueOnce(Response.json({ ...server, nextPage: 1 }))
    .mockResolvedValueOnce(Response.json({ ...refreshed, commits: [] }))
    .mockResolvedValueOnce(Response.json(refreshed));

  render(<Portal />);
  fireEvent.click(await screen.findByRole('button', { name: 'More commits' }));
  expect(await screen.findByText('New review')).toBeDefined();
  expect(screen.queryByText('Review this commit')).toBeNull();
  expect(fetch.mock.calls.map(([route]) => route)).toEqual([
    '/v1/server?page=0',
    '/v1/server?page=1',
    '/v1/server?page=0',
  ]);
});

test.each([true, false])('recovers a pending approval and submits decision %s', async approved => {
  const fetch = mockFetch();
  fetch
    .mockResolvedValueOnce(Response.json({ ...server, activeRelease: id }))
    .mockResolvedValueOnce(
      Response.json({
        ...release,
        state: 'approval',
        stage: 'migrations',
        approval: { id: approvalId, kind: 'migrations', message: 'Apply 1 migration?' },
      }),
    )
    .mockResolvedValueOnce(Response.json({ ...release, stage: 'migrations' }));

  render(<Portal />);
  expect(await screen.findByText('Apply 1 migration?')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: approved ? 'Approve' : 'Decline' }));
  await waitFor(() => expect(screen.queryByText('Apply 1 migration?')).toBeNull());
  expect(fetch.mock.calls[2]?.[0]).toBe(`/v1/releases/${id}/approvals/${approvalId}`);
  expect(fetch.mock.calls[2]?.[1]?.body).toMatch(
    new RegExp(`^\\{"approved":${approved},"requestId":"[a-f0-9-]{36}"\\}$`),
  );
});

test('reuses the request ID after a lost start response and requires review after a conflict', async () => {
  const fetch = mockFetch();
  fetch
    .mockResolvedValueOnce(Response.json(server))
    .mockRejectedValueOnce(new TypeError('Lost response'))
    .mockResolvedValueOnce(new Response(null, { status: 409 }))
    .mockResolvedValueOnce(Response.json(server))
    .mockResolvedValueOnce(Response.json(release, { status: 202 }));

  render(<Portal />);
  await screen.findByText('Review this commit');
  fireEvent.click(screen.getByRole('button', { name: 'Start release' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Cannot reach'));
  fireEvent.click(screen.getByRole('button', { name: 'Start release' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Refresh and review'));
  expect(fetch.mock.calls[1]?.[1]?.body).toBe(fetch.mock.calls[2]?.[1]?.body);
  fireEvent.click(screen.getByRole('button', { name: 'Start release' }));
  expect(fetch).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Start release' }));
  expect(await screen.findByRole('heading', { name: 'Release progress' })).toBeDefined();
  expect(fetch.mock.calls[4]?.[1]?.body).not.toBe(fetch.mock.calls[1]?.[1]?.body);
});

import type {
  AppStart,
  AppStatus,
  Decision,
  Release,
  ServerStatus,
  Start,
} from '../../../server/devportal/contracts.ts';

export type Destination = Release['target'];

export type Review = ServerStatus | AppStatus;

const connectionError = 'Cannot reach the release service. Check Tailscale and the release Mac, then retry.';

function errorMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Connect to Tailscale using an allowed account.';
    case 403:
      return 'Your account cannot perform this request from this address.';
    case 409:
      return 'The release changed. Refresh and review it again.';
    default:
      return connectionError;
  }
}

export interface RequestFailure {
  readonly ok: false;
  readonly status: number;
  readonly message: string;
}

type Response<T> = { readonly ok: true; readonly data: T } | RequestFailure;

async function request<T>(path: string, signal: AbortSignal, body?: Start | AppStart | Decision): Promise<Response<T>> {
  try {
    const response = await fetch(path, {
      signal,
      cache: 'no-store',
      redirect: 'error',
      ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      return { ok: false, status: response.status, message: errorMessage(response.status) };
    }

    // This same-origin API validates its release contract and ships with this bundle.
    const data: T = await response.json();

    return { ok: true, data };
  } catch {
    return { ok: false, status: 0, message: connectionError };
  }
}

export function getReview(destination: Destination, page: number, signal: AbortSignal): Promise<Response<Review>> {
  const path = destination === 'server' ? '/v1/server' : `/v1/apps/${destination}`;

  return request<Review>(`${path}?page=${page}`, signal);
}

export function getRelease(id: string, signal: AbortSignal) {
  return request<Release>(`/v1/releases/${id}`, signal);
}

export function startRelease(destination: Destination, input: Start, signal: AbortSignal) {
  return destination === 'server'
    ? request<Release>('/v1/releases', signal, input)
    : request<Release>('/v1/app-releases', signal, { ...input, platform: destination });
}

export function decideRelease(id: string, approvalId: string, input: Decision, signal: AbortSignal) {
  return request<Release>(`/v1/releases/${id}/approvals/${approvalId}`, signal, input);
}

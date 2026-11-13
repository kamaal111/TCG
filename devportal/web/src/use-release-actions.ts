import { useRef } from 'react';

import { decideRelease, startRelease, type Destination, type RequestFailure } from './api.ts';
import type { RunOperation } from './use-portal-operation.ts';
import type { Decision, Release, Start } from '../../../server/devportal/contracts.ts';

interface ReleaseActions {
  destination: Destination;
  perform: RunOperation;
  onSuccess: (release: Release) => void;
  onFailure: (failure: RequestFailure) => void;
}

export function useReleaseActions({ destination, perform, onSuccess, onFailure }: ReleaseActions) {
  const startRequest = useRef<Start | null>(null);
  const decisionRequest = useRef<(Decision & { approvalId: string }) | null>(null);

  function submit(send: (signal: AbortSignal) => ReturnType<typeof startRelease>, clear: () => void) {
    return perform(async signal => {
      const result = await send(signal);

      if (signal.aborted) {
        return;
      }

      if (result.ok) {
        clear();
        onSuccess(result.data);

        return;
      }

      onFailure(result);
    });
  }

  function start(sha: string, fingerprint: string) {
    return submit(
      signal => {
        const previous = startRequest.current;

        const input =
          previous?.sha === sha && previous.fingerprint === fingerprint
            ? previous
            : { sha, fingerprint, requestId: crypto.randomUUID() };

        startRequest.current = input;

        return startRelease(destination, input, signal);
      },
      () => {
        startRequest.current = null;
      },
    );
  }

  function decide(id: string, approvalId: string, approved: boolean) {
    return submit(
      signal => {
        const previous = decisionRequest.current;

        const requestId =
          previous?.approvalId === approvalId && previous.approved === approved
            ? previous.requestId
            : crypto.randomUUID();

        decisionRequest.current = { approvalId, approved, requestId };

        return decideRelease(id, approvalId, { approved, requestId }, signal);
      },
      () => {
        decisionRequest.current = null;
      },
    );
  }

  function clearRequests() {
    startRequest.current = null;
    decisionRequest.current = null;
  }

  return { start, decide, clearRequests };
}

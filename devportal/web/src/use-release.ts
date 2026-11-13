import { useEffect, useEffectEvent, useState } from 'react';

import { getRelease, getReview, type Destination, type RequestFailure, type Review } from './api.ts';
import { usePortalOperation } from './use-portal-operation.ts';
import { useReleaseActions } from './use-release-actions.ts';
import type { Release } from '../../../server/devportal/contracts.ts';

function fingerprint(review: Review) {
  return 'platform' in review ? review.fingerprint : review.host?.fingerprint;
}

function isActive(release: Release | undefined) {
  return release?.state === 'running' || release?.state === 'approval';
}

export function useRelease(destination: Destination) {
  const [review, setReview] = useState<Review>();
  const [release, setRelease] = useState<Release>();
  const [error, setError] = useState<string>();
  const [pollError, setPollError] = useState<string>();
  const [needsRefresh, setNeedsRefresh] = useState(true);
  const { busy, perform } = usePortalOperation();

  const { start, decide, clearRequests } = useReleaseActions({
    destination,
    perform,
    onSuccess: updateRelease,
    onFailure: failed,
  });

  async function refresh(signal: AbortSignal) {
    setNeedsRefresh(true);
    setPollError(undefined);
    const result = await getReview(destination, 0, signal);

    if (signal.aborted) {
      return;
    }

    if (!result.ok) {
      setError(result.message);

      return;
    }

    setReview(result.data);
    const { activeRelease, latestRelease } = result.data;
    const id = activeRelease ?? latestRelease;

    if (id) {
      const current = await getRelease(id, signal);

      if (signal.aborted) {
        return;
      }

      if (!current.ok) {
        setError(current.message);

        return;
      }

      setRelease(current.data);
    } else {
      setRelease(undefined);
    }

    setError(undefined);
    setNeedsRefresh(false);
  }

  const refreshOnMount = useEffectEvent(() => {
    void perform(refresh);
  });

  useEffect(() => {
    refreshOnMount();
  }, [destination]);

  const activeId = isActive(release) ? release?.id : undefined;

  const poll = useEffectEvent((id: string) => {
    void perform(async signal => {
      const result = await getRelease(id, signal);

      if (signal.aborted) {
        return;
      }

      if (!result.ok) {
        setPollError(result.message);

        return;
      }

      setRelease(result.data);
      setPollError(undefined);

      if (!isActive(result.data)) {
        await refresh(signal);
      }
    }, false);
  });

  useEffect(() => {
    if (activeId) {
      const timer = window.setInterval(() => poll(activeId), 2000);

      return () => window.clearInterval(timer);
    }
  }, [activeId]);

  const canRetry = release?.sha === review?.main && (release?.state === 'failed' || release?.state === 'interrupted');

  const reviewedFingerprint = review && fingerprint(review);

  const canStart = Boolean(
    review &&
    reviewedFingerprint &&
    !review.blocker &&
    !review.activeRelease &&
    !needsRefresh &&
    !busy &&
    !activeId &&
    (destination !== 'server' || review.pending > 0 || canRetry),
  );

  function failed(result: RequestFailure) {
    setError(result.message);

    if (result.status === 409) {
      clearRequests();
      setNeedsRefresh(true);
    }
  }

  function loadMore() {
    const page = review?.nextPage;

    if (!review || page == null) {
      return;
    }

    return perform(async signal => {
      const result = await getReview(destination, page, signal);

      if (signal.aborted) {
        return;
      }

      if (!result.ok) {
        return failed(result);
      }

      const next = result.data;

      if (review.main !== next.main || fingerprint(review) !== fingerprint(next)) {
        await refresh(signal);

        return;
      }

      const { commits, nextPage } = next;
      setReview({ ...review, commits: [...review.commits, ...commits], nextPage });
      setError(undefined);
    });
  }

  function updateRelease(next: Release) {
    setRelease(next);
    setError(undefined);
  }

  function startReviewedRelease() {
    if (review && canStart && reviewedFingerprint) {
      return start(review.main, reviewedFingerprint);
    }
  }

  function decidePendingApproval(approved: boolean) {
    if (release?.approval && !needsRefresh) {
      return decide(release.id, release.approval.id, approved);
    }
  }

  return {
    review,
    release,
    error: error ?? pollError,
    needsRefresh,
    busy,
    canStart,
    canRetry,
    loadMore,
    start: startReviewedRelease,
    decide: decidePendingApproval,
    refresh: () => perform(refresh),
  };
}

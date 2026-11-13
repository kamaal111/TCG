import type { Destination } from './api.ts';
import { DESTINATIONS } from './destinations.ts';
import { ReleaseProgress } from './release-progress.tsx';
import { ReleaseReview } from './release-review.tsx';
import { useRelease } from './use-release.ts';

export function DestinationPanel({ destination }: { destination: Destination }) {
  const portal = useRelease(destination);
  const { review, release, error, busy } = portal;

  return (
    <>
      <div className="row title">
        <h2>{DESTINATIONS[destination]} release</h2>
        <button type="button" disabled={busy} onClick={portal.refresh}>
          Refresh
        </button>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {!review && !error && <p role="status">Loading release status…</p>}
      {review && (
        <ReleaseReview
          review={review}
          busy={busy}
          canStart={portal.canStart}
          canRetry={portal.canRetry}
          start={portal.start}
          loadMore={portal.loadMore}
        />
      )}
      {release && (
        <ReleaseProgress release={release} canDecide={!busy && !portal.needsRefresh} decide={portal.decide} />
      )}
    </>
  );
}

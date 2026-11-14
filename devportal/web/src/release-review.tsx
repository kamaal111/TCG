import type { Review } from './api.ts';
import { Detail, Revision } from './release-details.tsx';

const commitAreaLabels: Record<Review['commits'][number]['area'], string> = {
  server: 'Server',
  app: 'App',
  both: 'Server + App',
  other: 'Other',
};

export function ReleaseReview({
  review,
  busy,
  canStart,
  canRetry,
  start,
  loadMore,
}: {
  review: Review;
  busy: boolean;
  canStart: boolean;
  canRetry: boolean;
  start: () => void;
  loadMore: () => void;
}) {
  const status = review;
  const app = 'platform' in review ? review : undefined;

  return (
    <section className="card" aria-labelledby="review-heading">
      <div className="row">
        <h2 id="review-heading">Review release</h2>
        <button type="button" className="primary" disabled={!canStart} onClick={start}>
          {canRetry ? 'Retry release' : 'Start release'}
        </button>
      </div>
      <dl>
        <Detail label="Target">{status.target}</Detail>
        <Detail label={app ? 'Last uploaded' : 'Running'}>
          <Revision sha={app?.uploaded ?? status.host?.revision} />
        </Detail>
        <Detail label="Remote main">
          <Revision sha={status.main} />
        </Detail>
        {app && <Detail label="Version">{app.version}</Detail>}
        {app?.teamID && <Detail label="Signing team">{app.teamID}</Detail>}
        {app?.apiHost && <Detail label="API host">https://{app.apiHost}</Detail>}
      </dl>
      {status.blocker && <p className="notice">{status.blocker}</p>}
      <h3>Pending changes</h3>
      <p>{status.pending === 0 ? 'Up to date' : `${status.pending} pending commits`}</p>
      {status.commits.length > 0 && (
        <ul className="commits">
          {status.commits.map(commit => {
            return (
              <li key={commit.sha}>
                <div className="commit-heading">
                  <strong>{commit.subject}</strong>
                  <span className="commit-area">{commitAreaLabels[commit.area]}</span>
                </div>
                <span className="commit-details">
                  <Revision sha={commit.sha} /> · {commit.author} · {commit.date}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {status.nextPage !== null && (
        <button type="button" disabled={busy} onClick={loadMore}>
          More commits
        </button>
      )}
    </section>
  );
}

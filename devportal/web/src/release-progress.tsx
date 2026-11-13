import type { Destination } from './api.ts';
import { ReleaseApproval } from './release-approval.tsx';
import { Revision } from './release-details.tsx';
import type { Release } from '../../../server/devportal/contracts.ts';

const APP_STAGES: readonly Release['stage'][] = ['checks', 'archive', 'upload'];

const STAGES: Record<Destination, readonly Release['stage'][]> = {
  server: ['build', 'migrations', 'deploy', 'verify'],
  ios: APP_STAGES,
  macos: APP_STAGES,
};

const STAGE_LABELS: Record<Release['stage'], string> = {
  build: 'Build and publish',
  migrations: 'Database migrations',
  deploy: 'Deploy',
  verify: 'Verify',
  checks: 'Check app',
  archive: 'Archive and sign',
  upload: 'Upload',
};

const STATES: Record<Release['state'], string> = {
  running: 'In progress',
  approval: 'Waiting for approval',
  succeeded: 'Complete',
  failed: 'Stopped',
  interrupted: 'Interrupted',
};

export function ReleaseProgress({
  release,
  canDecide,
  decide,
}: {
  release: Release;
  canDecide: boolean;
  decide: (approved: boolean) => void;
}) {
  const { approval, events, failure, sha, state, target } = release;
  const stages = STAGES[target];
  const current = stages.indexOf(release.stage);

  return (
    <section className="card" aria-labelledby="release-heading">
      <div className="row">
        <h2 id="release-heading">Release progress</h2>
        <Revision sha={sha} />
      </div>
      <ol className="stages">
        {stages.map((stage, index) => {
          let label = 'Not started';

          if (index < current || state === 'succeeded') {
            label = 'Complete';
          } else if (index === current) {
            label = STATES[state];
          }

          return (
            <li key={stage} aria-current={stage === release.stage ? 'step' : undefined}>
              {STAGE_LABELS[stage]}
              <span>{label}</span>
            </li>
          );
        })}
      </ol>
      {state === 'succeeded' && (
        <p role="status">
          {target === 'server' ? 'Release checks passed' : 'Uploaded to App Store Connect. Processing pending.'}
        </p>
      )}
      {failure && (
        <p className="notice" role="status">
          {failure}
        </p>
      )}
      {approval && <ReleaseApproval approval={approval} canDecide={canDecide} decide={decide} />}
      {events.length > 0 && (
        <details open>
          <summary>Activity</summary>
          <ul className="activity">
            {events.map((event, index) => {
              return (
                <li key={`${event.at}:${index}`}>
                  <time dateTime={event.at}>{event.at.slice(11, 19)} UTC</time> {event.message}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}

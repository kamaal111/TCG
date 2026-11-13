import { DESTINATIONS } from './destinations.ts';
import { Detail, Revision } from './release-details.tsx';
import type { Release } from '../../../server/devportal/contracts.ts';

export function ReleaseApproval({
  approval,
  canDecide,
  decide,
}: {
  approval: NonNullable<Release['approval']>;
  canDecide: boolean;
  decide: (approved: boolean) => void;
}) {
  return (
    <section className="approval" aria-label="Approval required">
      <h3>Approval required</h3>
      {approval.review && (
        <dl>
          <Detail label="Target">{approval.review.target}</Detail>
          <Detail label="Running">
            <Revision sha={approval.review.running} />
          </Detail>
          <Detail label="Reviewed revision">
            <Revision sha={approval.review.sha} />
          </Detail>
          {approval.review.pendingMigrations !== undefined && (
            <Detail label="Pending migration steps">{approval.review.pendingMigrations}</Detail>
          )}
        </dl>
      )}
      {approval.appReview && (
        <dl>
          <Detail label="Platform and version">
            {DESTINATIONS[approval.appReview.platform]} · {approval.appReview.version}
          </Detail>
          <Detail label="Signing team">{approval.appReview.teamID} · io.kamaal.TCG</Detail>
          <Detail label="API host">https://{approval.appReview.apiHost}</Detail>
          <Detail label="Reviewed revision">
            <Revision sha={approval.appReview.sha} />
          </Detail>
        </dl>
      )}
      <p>{approval.message}</p>
      {approval.kind === 'migrations' && (
        <p>
          Back up the database and confirm the running app supports the new schema. Migrations cannot be automatically
          undone.
        </p>
      )}
      <div className="actions">
        <button type="button" disabled={!canDecide} onClick={() => decide(false)}>
          Decline
        </button>
        <button type="button" className="primary" disabled={!canDecide} onClick={() => decide(true)}>
          Approve
        </button>
      </div>
    </section>
  );
}

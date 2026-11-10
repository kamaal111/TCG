import { getProcessLogger } from '@tcg/http/logging';
import type { DomainLogFields, DomainLogger } from '@tcg/http/logging';

import type { Release } from './contracts.ts';

type ReleaseLogFields = DomainLogFields<'devportal.release.transition'> & {
  release_id: string;
  release_sha: string;
  release_stage: Release['stage'];
  release_state: Release['state'];
  operator_login: string;
};

export function logReleaseTransition(release: Release): void {
  const logger: DomainLogger<ReleaseLogFields> = getProcessLogger();

  const fields: ReleaseLogFields = {
    event: 'devportal.release.transition',
    outcome: release.state === 'failed' || release.state === 'interrupted' ? 'failure' : 'success',
    release_id: release.id,
    release_sha: release.sha,
    release_stage: release.stage,
    release_state: release.state,
    operator_login: release.decisions.at(-1)?.operator ?? release.operator,
  };

  if (fields.outcome === 'failure') {
    logger.warn(fields, 'Saved release state.');
  } else {
    logger.info(fields, 'Saved release state.');
  }
}

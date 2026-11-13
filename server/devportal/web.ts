import fs from 'node:fs/promises';
import url from 'node:url';

import { InfraFailure } from '../../scripts/infra/errors.ts';

export const webRoot = url.fileURLToPath(new URL('../../devportal/web/dist/', import.meta.url));

export async function requireWebBundle(): Promise<void> {
  try {
    await fs.access(new URL('../../devportal/web/dist/index.html', import.meta.url), fs.constants.R_OK);
  } catch {
    throw new InfraFailure(
      'The Devportal web build is missing. Rerun just install-devportal-agent or just build-devportal-web.',
    );
  }
}

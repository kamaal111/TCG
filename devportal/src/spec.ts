import fs from 'node:fs/promises';

import * as yaml from 'js-yaml';

import { createDevportalApp } from './app.ts';
import { ReleaseSessions } from './sessions.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';

function devportalSpecification(): string {
  const app = createDevportalApp(
    new ReleaseSessions({
      directory: '',
      configDirectory: '',
      inspect: async () => {
        throw new InfraFailure('Specification generation does not inspect servers.');
      },
      run: async () => {
        throw new InfraFailure('Specification generation does not release.');
      },
    }),
    [],
  );

  return yaml.dump(
    app.getOpenAPIDocument({
      openapi: '3.1.0',
      info: { title: 'Mintomo Devportal', version: '1.0.0' },
      servers: [{ url: 'https://devportal.example.ts.net' }],
    }),
    { noRefs: true, indent: 2 },
  );
}

if (import.meta.main) {
  await fs.writeFile('app/Modules/MintomoDevportal/Sources/MintomoDevportal/openapi.yaml', devportalSpecification());
}

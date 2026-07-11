import * as yaml from 'js-yaml';
import type { Hono } from 'hono';

import { STATUS_CODES } from './constants/http.ts';
import { MIME_TYPES } from './constants/request.ts';
import type { HonoEnvironment } from './context.ts';
import { OPENAPI_JSON_SPEC_PATH, OPENAPI_YAML_SPEC_PATH } from './open-api.ts';
import { integrationTest } from './tests/fixtures.ts';

describe('OpenAPI specification integration', () => {
  integrationTest('downloads a specification with a valid JSON document shape', async ({ app }) => {
    const response = await sendSpecRequest(app, OPENAPI_JSON_SPEC_PATH);

    expect(response.status).toBe(STATUS_CODES.OK);
    expect(response.headers.get('content-type')).toContain(MIME_TYPES.JSON);
    expectDocumentShape(await response.json());
  });

  integrationTest('downloads a specification with a valid YAML document shape', async ({ app }) => {
    const response = await sendSpecRequest(app, OPENAPI_YAML_SPEC_PATH);

    expect(response.status).toBe(STATUS_CODES.OK);
    expect(response.headers.get('content-type')).toContain(MIME_TYPES.YAML);
    expectDocumentShape(yaml.load(await response.text()));
  });
});

async function sendSpecRequest(app: Hono<HonoEnvironment>, path: string) {
  return app.request(path);
}

function expectDocumentShape(document: unknown) {
  expect(document).toEqual(expect.anything());
  expect(typeof document).toBe('object');
  expect(Array.isArray(document)).toBe(false);
}

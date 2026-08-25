import type { Hono } from 'hono';
import * as yaml from 'js-yaml';

import { SIGN_UP_ROUTE_PATH } from './auth/constants.ts';
import { createCardRequest, validCardPayload } from './cards/tests/utils.ts';
import { STATUS_CODES } from './constants/http.ts';
import { MIME_TYPES } from './constants/request.ts';
import type { HonoEnvironment } from './context.ts';
import { OPENAPI_JSON_SPEC_PATH, OPENAPI_YAML_SPEC_PATH } from './open-api.ts';
import { expectValidationIssueForFields } from './tests/auth.ts';
import { integrationTest } from './tests/fixtures.ts';
import { createTestUser } from './tests/utils.ts';

interface SpecificationDocument {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, Record<string, unknown>> };
}

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

  integrationTest('agrees between the JSON and YAML documents', async ({ app }) => {
    const jsonDocument = await readSpecification(app);
    const yamlResponse = await sendSpecRequest(app, OPENAPI_YAML_SPEC_PATH);

    expect(yaml.load(await yamlResponse.text())).toEqual(jsonDocument);
  });

  integrationTest('rejects an invalid auth payload with the same envelope cards routes use', async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const authResponse = await app.request(SIGN_UP_ROUTE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'password123', name: 'Test User' }),
    });
    const cardsResponse = await createCardRequest(app, user.sessionToken, { ...validCardPayload, name: '' });

    await expectValidationIssueForFields(authResponse, ['email']);
    await expectValidationIssueForFields(cardsResponse, ['name']);
  });

  integrationTest('describes both the auth routes and the standard-schema routes', async ({ app }) => {
    const document = await readSpecification(app);

    expect(Object.keys(document.paths)).toEqual([
      '/app-api/auth/sign-up/email',
      '/app-api/auth/sign-in/email',
      '/app-api/auth/sign-out',
      '/app-api/auth/session',
      '/app-api/auth/token',
      '/app-api/cards',
      '/app-api/cards/{cardId}',
      '/app-api/pricing/search',
    ]);
  });

  integrationTest('names the components the standard-schema routes refer to', async ({ app }) => {
    const document = await readSpecification(app);

    expect(Object.keys(document.components.schemas)).toEqual(
      expect.arrayContaining(['Card', 'CardWithPrice', 'UpsertCard', 'PricedCard', 'PricingSearchResponse']),
    );
    expect(document.paths['/app-api/cards']?.get).toMatchObject({
      responses: {
        200: { content: { [MIME_TYPES.JSON]: { schema: { $ref: '#/components/schemas/CardsListResponse' } } } },
      },
    });
  });

  integrationTest('keeps one definition of an error response shared by both halves', async ({ app }) => {
    const document = await readSpecification(app);

    expect(document.components.schemas.ErrorResponse).toEqual({
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Error message' },
        code: { type: 'string', description: 'Error code' },
      },
      required: ['message'],
      title: 'Error Response',
      description: 'Error response containing error message and optional error code',
    });
  });

  integrationTest('composes an owned card with its price instead of repeating the card fields', async ({ app }) => {
    const document = await readSpecification(app);

    expect(document.components.schemas.CardWithPrice?.allOf).toEqual([
      { $ref: '#/components/schemas/Card' },
      {
        type: 'object',
        properties: { price: { $ref: '#/components/schemas/OwnedCardPrice' } },
        required: ['price'],
      },
    ]);
  });

  integrationTest('describes the card identifier as a required path parameter', async ({ app }) => {
    const document = await readSpecification(app);

    expect(document.paths['/app-api/cards/{cardId}']?.delete).toMatchObject({
      parameters: [
        {
          name: 'cardId',
          in: 'path',
          required: true,
          description: 'Unique card entry identifier',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
    });
  });
});

async function sendSpecRequest(app: Hono<HonoEnvironment>, path: string) {
  return app.request(path);
}

async function readSpecification(app: Hono<HonoEnvironment>): Promise<SpecificationDocument> {
  const response = await sendSpecRequest(app, OPENAPI_JSON_SPEC_PATH);

  return response.json();
}

function expectDocumentShape(document: unknown) {
  expect(document).toEqual(expect.anything());
  expect(typeof document).toBe('object');
  expect(Array.isArray(document)).toBe(false);
}

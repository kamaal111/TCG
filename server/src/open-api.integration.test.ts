import type { Hono } from 'hono';
import * as yaml from 'js-yaml';
import { z } from 'zod';

import { SIGN_UP_ROUTE_PATH } from './auth/constants.ts';
import { createCardRequest, validCardPayload } from './cards/tests/utils.ts';
import { MAX_BINDER_DIMENSION } from './collections/constants.ts';
import { DEFAULT_COLLECTION_POLICY } from './config.ts';
import { CONTENTFUL_STATUS_CODES } from './constants/http.ts';
import { MIME_TYPES } from './constants/request.ts';
import type { HonoEnvironment } from './context.ts';
import { CURRENCY_CODES } from './forex/currencies.ts';
import { OPENAPI_JSON_SPEC_PATH, OPENAPI_YAML_SPEC_PATH } from './open-api.ts';
import { expectValidationIssueForFields } from './tests/auth.ts';
import { integrationTest } from './tests/fixtures.ts';

const SpecificationDocumentSchema = z
  .object({
    openapi: z.string(),
    paths: z.record(z.string(), z.record(z.string(), z.json())),
    components: z.object({ schemas: z.record(z.string(), z.record(z.string(), z.json())) }).loose(),
  })
  .loose();

type SpecificationDocument = z.infer<typeof SpecificationDocumentSchema>;

describe('OpenAPI specification integration', () => {
  integrationTest('shares currency definitions across purchase and import schemas', async ({ app }) => {
    const document = await readSpecification(app);

    expect(document.components.schemas.Currency).toMatchObject({ type: 'string', enum: [...CURRENCY_CODES] });
    expect(document.components.schemas.NullableCurrency).toMatchObject({
      type: ['null', 'string'],
      enum: [...CURRENCY_CODES, null],
    });
    expect(document.components.schemas.NullableCurrency).not.toHaveProperty('default');
    expect(document.components.schemas.CardPurchase).toMatchObject({
      properties: { currency: { $ref: '#/components/schemas/NullableCurrency' } },
    });
    expect(document.components.schemas.CardPurchaseInput).toMatchObject({
      properties: { currency: { $ref: '#/components/schemas/NullableCurrency' } },
    });
    expect(document.components.schemas.ImportCard).toMatchObject({
      properties: {
        notes: { type: ['null', 'string'], maxLength: 2000 },
        purchases: {
          items: {
            properties: { currency: { $ref: '#/components/schemas/NullableCurrency', default: null } },
          },
        },
      },
    });
  });

  integrationTest('downloads a specification with a valid JSON document shape', async ({ app }) => {
    const response = await sendSpecRequest(app, OPENAPI_JSON_SPEC_PATH);

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    expect(response.headers.get('content-type')).toContain(MIME_TYPES.JSON);
    expectSpecificationDocument(await response.json());
  });

  integrationTest('downloads a specification with a valid YAML document shape', async ({ app }) => {
    const response = await sendSpecRequest(app, OPENAPI_YAML_SPEC_PATH);

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    expect(response.headers.get('content-type')).toContain(MIME_TYPES.YAML);
    expectSpecificationDocument(SpecificationDocumentSchema.parse(yaml.load(await response.text())));
  });

  integrationTest('agrees between the JSON and YAML documents', async ({ app }) => {
    const jsonDocument = await readSpecification(app);
    const yamlResponse = await sendSpecRequest(app, OPENAPI_YAML_SPEC_PATH);

    expect(yaml.load(await yamlResponse.text())).toEqual(jsonDocument);
  });

  integrationTest('rejects an invalid auth payload with the same envelope cards routes use', async ({ app, user }) => {
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
      '/app-api/auth/preferences',
      '/app-api/forex/latest',
      '/app-api/images/{imageKey}',
      '/app-api/cards/export',
      '/app-api/cards/import',
      '/app-api/cards',
      '/app-api/cards/{cardId}',
      '/app-api/collections/import-preview',
      '/app-api/collections',
      '/app-api/collections/export',
      '/app-api/collections/import',
      '/app-api/collections/{collectionId}',
      '/app-api/collections/{collectionId}/layout',
      '/app-api/collections/{collectionId}/pages/{pageId}',
      '/app-api/pricing/search',
    ]);
    expect(document.paths['/app-api/collections/{collectionId}']?.get).toMatchObject({
      responses: {
        200: { content: { [MIME_TYPES.JSON]: { schema: { $ref: '#/components/schemas/CardCollection' } } } },
      },
    });
  });

  integrationTest('documents one deletion operation with an array request', async ({ app }) => {
    const document = await readSpecification(app);
    expect(document.paths['/app-api/cards']?.delete).toMatchObject({
      requestBody: { content: { [MIME_TYPES.JSON]: { schema: { $ref: '#/components/schemas/DeleteCards' } } } },
      responses: {
        200: { content: { [MIME_TYPES.JSON]: { schema: { $ref: '#/components/schemas/DeleteCardsResponse' } } } },
      },
    });
    expect(document.paths['/app-api/cards/{cardId}']?.delete).toBeUndefined();
    expect(document.paths['/app-api/cards/bulk-delete']).toBeUndefined();
    expect(document.components.schemas.DeleteCardResponse).toBeUndefined();
  });

  integrationTest('names the components the standard-schema routes refer to', async ({ app }) => {
    const document = await readSpecification(app);

    expect(Object.keys(document.components.schemas)).toEqual(
      expect.arrayContaining([
        'Card',
        'CardWithPrice',
        'UpsertCard',
        'DeleteCards',
        'DeleteCardsResponse',
        'PricedCard',
        'PricingSearchResponse',
      ]),
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

  integrationTest(
    'shares collection summaries and binder layouts while preserving layout request limits',
    async ({ app }) => {
      const document = await readSpecification(app);
      const layoutReference = { $ref: '#/components/schemas/BinderLayout' };

      expect(document.components.schemas.CardCollection).toMatchObject({
        allOf: [{ $ref: '#/components/schemas/CardCollectionSummary' }, layoutReference],
        description: expect.any(String),
        example: expect.any(Object),
      });
      expect(document.components.schemas.CardCollection).not.toHaveProperty('properties');
      expect(document.components.schemas.UpdateCollection).toMatchObject({
        allOf: [{ $ref: '#/components/schemas/CreateCollection' }, { required: ['revision'] }],
      });
      expect(document.components.schemas.BinderLayout).toMatchObject({
        properties: {
          columns: { maximum: MAX_BINDER_DIMENSION },
          rows: { maximum: MAX_BINDER_DIMENSION },
          pages: { items: { $ref: '#/components/schemas/BinderPage' } },
        },
        required: ['columns', 'rows', 'pages'],
      });
      expect(document.components.schemas.SaveBinderLayout).toMatchObject({
        allOf: [
          layoutReference,
          {
            properties: { pages: { maxItems: DEFAULT_COLLECTION_POLICY.COLLECTION_MAX_PAGES } },
            required: ['revision'],
          },
        ],
      });
    },
  );

  integrationTest('describes the update card identifier as a required path parameter', async ({ app }) => {
    const document = await readSpecification(app);

    expect(document.paths['/app-api/cards/{cardId}']?.put).toMatchObject({
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

  return SpecificationDocumentSchema.parse(await response.json());
}

function expectSpecificationDocument(document: z.input<typeof SpecificationDocumentSchema>) {
  expect(SpecificationDocumentSchema.safeParse(document).success).toBe(true);
}

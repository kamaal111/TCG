import { $, OpenAPIHono, z } from '@hono/zod-openapi';
import type { BlankSchema, Env, Schema } from 'hono/types';
import { swaggerUI } from '@hono/swagger-ui';
import * as yaml from 'js-yaml';

import type { HonoEnvironment } from './context.ts';
import { InvalidValidation } from './exceptions/index.ts';
import env from './env.ts';
import { STATUS_CODES } from './constants/http.ts';
import { MIME_TYPES } from './constants/request.ts';

const SPEC_NAME = '/spec';
export const OPENAPI_JSON_SPEC_PATH = `${SPEC_NAME}.json`;
export const OPENAPI_YAML_SPEC_PATH = `${SPEC_NAME}.yaml`;
export const OPENAPI_YAML_SPEC_URL = new URL(`${env.BASE_URL}${OPENAPI_YAML_SPEC_PATH}`);
const SPEC_SOURCE_OF_TRUTH_URL = OPENAPI_JSON_SPEC_PATH;
const OPENAPI_INFO = {
  openapi: '3.1.1',
  info: { version: '1.0.0', title: 'TCG API' },
  servers: [{ url: env.BASE_URL }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
};

const OpenAPIInfoSchema = z.object({
  title: z.string(),
  version: z.string(),
  description: z.string().optional(),
});

const OpenAPIComponentsSchema = z
  .object({
    schemas: z.record(z.string(), z.object().loose()).optional(),
    securitySchemes: z.record(z.string(), z.unknown()).optional(),
  })
  .loose()
  .transform(components => ({
    ...components,
    securitySchemes: components.securitySchemes ?? OPENAPI_INFO.components.securitySchemes,
  }));

const OpenAPISpecSchema = z
  .object({
    openapi: z.string(),
    info: OpenAPIInfoSchema,
    paths: z.record(z.string(), z.record(z.string(), z.unknown())),
    components: OpenAPIComponentsSchema,
  })
  .loose();

export function openAPIRouterFactory(): OpenAPIHono<HonoEnvironment, BlankSchema, '/'> {
  const router = new OpenAPIHono<HonoEnvironment>({
    defaultHook: (result, c) => {
      if (!result.success) {
        throw new InvalidValidation(c, result.error);
      }
    },
  });

  return router;
}

export function withOpenAPIDocumentation<
  E extends Env = Env,
  S extends Schema = BlankSchema,
  BasePath extends string = '/',
>(app: OpenAPIHono<E, S, BasePath>) {
  const documentedApp = app.doc(SPEC_SOURCE_OF_TRUTH_URL, OPENAPI_INFO);
  const appWithYamlSpec = withYamlSpec(documentedApp, { url: SPEC_SOURCE_OF_TRUTH_URL });

  return $(appWithYamlSpec.get('/doc', swaggerUI({ url: SPEC_SOURCE_OF_TRUTH_URL })));
}

function withYamlSpec<E extends Env = Env, S extends Schema = BlankSchema, BasePath extends string = '/'>(
  app: OpenAPIHono<E, S, BasePath>,
  options: { url: string },
) {
  return $(
    app.get(OPENAPI_YAML_SPEC_PATH, async c => {
      const origin = new URL(c.req.url).origin;
      const requestInit = new Request(`${origin}${options.url}`, {
        headers: { Accept: 'application/json' },
      });
      const response = await app.request(requestInit);
      const rawData: unknown = await response.json();
      const spec = OpenAPISpecSchema.parse(rawData);
      const transformedSpec = transformNullableToUnion(spec);
      const formattedSpec = yaml.dump(transformedSpec, { indent: 2 });

      return c.text(formattedSpec, STATUS_CODES.OK, { 'Content-Type': MIME_TYPES.YAML });
    }),
  );
}

function transformNullableToUnion(obj: unknown): unknown {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(transformNullableToUnion);
  if (typeof obj !== 'object') return obj;
  return transformDefiniteObjectNullableToUnion(obj);
}

function transformDefiniteObjectNullableToUnion(obj: object): object {
  return Object.entries(obj).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const entryIsInvalidNullable =
      key === 'type' && typeof value === 'string' && 'nullable' in obj && obj.nullable === true;
    if (entryIsInvalidNullable) return { ...acc, type: [null, value] };

    const keyIsNullable = key === 'nullable';
    const shouldFilterOut = keyIsNullable;
    if (shouldFilterOut) return acc;

    return { ...acc, [key]: transformNullableToUnion(value) };
  }, {});
}

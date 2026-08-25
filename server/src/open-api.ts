import { swaggerUI } from '@hono/swagger-ui';
import { $, StandardOpenAPIHono } from '@kamaalio/hono-standard-openapi';
import type { Env, Schema } from 'hono/types';
import * as yaml from 'js-yaml';
import { z } from 'zod';

import { STATUS_CODES } from './constants/http.ts';
import { MIME_TYPES } from './constants/request.ts';
import type { HonoEnvironment } from './context.ts';
import env from './env.ts';
import { InvalidValidation } from './exceptions/index.ts';

const SPEC_NAME = '/spec';
export const OPENAPI_JSON_SPEC_PATH = `${SPEC_NAME}.json`;
export const OPENAPI_YAML_SPEC_PATH = `${SPEC_NAME}.yaml`;
export const OPENAPI_YAML_SPEC_URL = new URL(`${env.BASE_URL}${OPENAPI_YAML_SPEC_PATH}`);
const SPEC_SOURCE_OF_TRUTH_URL = OPENAPI_JSON_SPEC_PATH;
export const YAML_OPTIONS = { indent: 2, noRefs: true };
const OPENAPI_INFO = {
  openapi: '3.1.1',
  info: { version: '1.0.0', title: 'TCG API' },
  servers: [{ url: env.BASE_URL }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } as const },
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
  .loose();

const OpenAPISpecSchema = z
  .object({
    openapi: z.string(),
    info: OpenAPIInfoSchema,
    paths: z.record(z.string(), z.record(z.string(), z.unknown())),
    components: OpenAPIComponentsSchema,
  })
  .loose();

export function openAPIRouterFactory(): StandardOpenAPIHono<HonoEnvironment> {
  return new StandardOpenAPIHono<HonoEnvironment>({
    defaultHook: (result, c) => {
      if (!result.success) {
        throw new InvalidValidation(c, result.error);
      }
    },
  });
}

export function withOpenAPIDocumentation<E extends Env = Env, S extends Schema = {}, BasePath extends string = '/'>(
  app: StandardOpenAPIHono<E, S, BasePath>,
) {
  const appWithSpecs = $(
    app
      .get(OPENAPI_JSON_SPEC_PATH, c => c.json(buildSpecification(app)))
      .get(OPENAPI_YAML_SPEC_PATH, c =>
        c.text(yaml.dump(buildSpecification(app), YAML_OPTIONS), STATUS_CODES.OK, {
          'Content-Type': MIME_TYPES.YAML,
        }),
      ),
  );

  return $(appWithSpecs.get('/doc', swaggerUI({ url: SPEC_SOURCE_OF_TRUTH_URL })));
}

function buildSpecification<E extends Env, S extends Schema, BasePath extends string>(
  app: StandardOpenAPIHono<E, S, BasePath>,
) {
  return OpenAPISpecSchema.parse(app.getOpenAPIDocument(OPENAPI_INFO));
}

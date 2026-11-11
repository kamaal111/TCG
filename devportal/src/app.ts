import { createRoute, defineOpenAPIRoute } from '@kamaalio/hono-standard-openapi';
import { REQUEST_ID_HEADER_NAME } from '@tcg/http/common';
import type { HttpEnvironment } from '@tcg/http/context';
import { handleServerError } from '@tcg/http/error-handler';
import { ErrorResponseSchema } from '@tcg/http/error-schemas';
import { Forbidden, NotFound, PayloadTooLarge, Unauthorized } from '@tcg/http/exceptions';
import { loggingMiddleware } from '@tcg/http/logging-middleware';
import { openAPIRouterFactory } from '@tcg/http/open-api';
import { bodyLimit } from 'hono/body-limit';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import z from 'zod';

import {
  AppStartSchema,
  AppStatusSchema,
  DecisionSchema,
  PageSchema,
  ReleaseSchema,
  ServerSchema,
  StartSchema,
} from './contracts.ts';
import type { ReleaseSessions } from './sessions.ts';

interface PortalEnvironment extends HttpEnvironment {
  Variables: HttpEnvironment['Variables'] & { operator: string };
}

const IdSchema = z.object({ id: z.uuid() });
const ApprovalIdSchema = IdSchema.extend({ approvalId: z.uuid() });

const errors = {
  413: { description: 'Request too large', content: { 'application/json': { schema: ErrorResponseSchema } } },
  400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponseSchema } } },
  401: { description: 'Tailscale identity required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  403: { description: 'Operator not allowed', content: { 'application/json': { schema: ErrorResponseSchema } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  409: {
    description: 'Refresh required or release busy',
    content: { 'application/json': { schema: ErrorResponseSchema } },
  },
  503: { description: 'Inspection unavailable', content: { 'application/json': { schema: ErrorResponseSchema } } },
};

export function createDevportalApp(sessions: ReleaseSessions, allowedLogins: readonly string[]) {
  const app = openAPIRouterFactory<PortalEnvironment>();
  app
    .onError(handleServerError<PortalEnvironment>())
    .use(requestId({ headerName: REQUEST_ID_HEADER_NAME }))
    .use(secureHeaders())
    .use(async (c, next) => {
      c.set('config', { MODE: 'SERVER' });
      await next();
    })
    .use(loggingMiddleware<PortalEnvironment>())
    .use(async (c, next) => {
      // Only the loopback backend behind Tailscale Serve may reach this app.
      const login = c.req.header('Tailscale-User-Login');

      if (!login) {
        throw new Unauthorized(c);
      }

      if (!allowedLogins.includes(login)) {
        throw new Forbidden();
      }

      // Browser cross-origin writes are never part of the native API contract.
      if (c.req.method !== 'GET' && c.req.header('Origin')) {
        throw new Forbidden();
      }

      c.set('operator', login);
      c.set('logger', c.get('logger').child({ user_id: login }));
      await next();
    });

  app.use(
    bodyLimit({
      maxSize: 16384,
      onError: () => {
        throw new PayloadTooLarge(undefined, { message: 'Request is too large.', code: 'PAYLOAD_TOO_LARGE' });
      },
    }),
  );

  const server = createRoute({
    method: 'get',
    path: '/v1/server',
    operationId: 'getServer',
    request: { query: PageSchema },
    responses: {
      200: { description: 'Server release review', content: { 'application/json': { schema: ServerSchema } } },
      ...errors,
    },
  });

  const start = createRoute({
    method: 'post',
    path: '/v1/releases',
    operationId: 'startRelease',
    request: { body: { required: true, content: { 'application/json': { schema: StartSchema } } } },
    responses: {
      202: { description: 'Release accepted', content: { 'application/json': { schema: ReleaseSchema } } },
      ...errors,
    },
  });

  const get = createRoute({
    method: 'get',
    path: '/v1/releases/{id}',
    operationId: 'getRelease',
    request: { params: IdSchema },
    responses: {
      200: { description: 'Release state', content: { 'application/json': { schema: ReleaseSchema } } },
      ...errors,
    },
  });

  const decide = createRoute({
    method: 'post',
    path: '/v1/releases/{id}/approvals/{approvalId}',
    operationId: 'answerApproval',
    request: {
      params: ApprovalIdSchema,
      body: { required: true, content: { 'application/json': { schema: DecisionSchema } } },
    },
    responses: {
      200: { description: 'Decision accepted', content: { 'application/json': { schema: ReleaseSchema } } },
      ...errors,
    },
  });

  const inspectApp = createRoute({
    method: 'get',
    path: '/v1/apps/{platform}',
    operationId: 'getApp',
    request: { params: z.object({ platform: z.enum(['ios', 'macos']) }), query: PageSchema },
    responses: {
      200: { description: 'App release review', content: { 'application/json': { schema: AppStatusSchema } } },
      ...errors,
    },
  });

  const startApp = createRoute({
    method: 'post',
    path: '/v1/app-releases',
    operationId: 'startAppRelease',
    request: { body: { required: true, content: { 'application/json': { schema: AppStartSchema } } } },
    responses: {
      202: { description: 'App release accepted', content: { 'application/json': { schema: ReleaseSchema } } },
      ...errors,
    },
  });

  app.openapiRoutes([
    defineOpenAPIRoute<PortalEnvironment, typeof inspectApp>({
      route: inspectApp,
      handler: async c => {
        return c.json(
          AppStatusSchema.parse(await sessions.appStatus(c.req.valid('param').platform, c.req.valid('query').page)),
          200,
        );
      },
    }),
    defineOpenAPIRoute<PortalEnvironment, typeof startApp>({
      route: startApp,
      handler: async c => c.json(await sessions.startApp(c.req.valid('json'), c.get('operator')), 202),
    }),
    defineOpenAPIRoute<PortalEnvironment, typeof server>({
      route: server,
      handler: async c => c.json(ServerSchema.parse(await sessions.status(c.req.valid('query').page)), 200),
    }),
    defineOpenAPIRoute<PortalEnvironment, typeof start>({
      route: start,
      handler: async c => c.json(await sessions.start(c.req.valid('json'), c.get('operator')), 202),
    }),
    defineOpenAPIRoute<PortalEnvironment, typeof get>({
      route: get,
      handler: c => c.json(sessions.get(c.req.valid('param').id), 200),
    }),
    defineOpenAPIRoute<PortalEnvironment, typeof decide>({
      route: decide,
      handler: async c => {
        const { id, approvalId } = c.req.valid('param');

        return c.json(await sessions.decide(id, approvalId, c.req.valid('json'), c.get('operator')), 200);
      },
    }),
  ]);
  app.all('*', c => new NotFound(c).getResponse());

  return app;
}

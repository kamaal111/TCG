import { Hono } from 'hono';

import type { HonoEnvironment } from '../context.ts';

export const HEALTH_ROUTE_NAME = '/health';

const healthRoute = new Hono<HonoEnvironment>();

healthRoute.get('/ping', c => {
  return c.json({ message: 'PONG' });
});

export default healthRoute;

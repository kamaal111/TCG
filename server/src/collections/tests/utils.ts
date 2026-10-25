import type { Hono } from 'hono';

import type { HonoEnvironment } from '../../context.ts';
import { CollectionSchema } from '../schemas/responses.ts';

export async function readCollection(app: Hono<HonoEnvironment>, headers: Headers, id: string) {
  const response = await app.request(`/app-api/collections/${id}`, { headers });
  expect(response.status).toBe(200);

  return CollectionSchema.parse(await response.json());
}

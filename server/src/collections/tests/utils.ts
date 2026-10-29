import type { Hono } from 'hono';
import type { z } from 'zod';

import type { HonoEnvironment } from '../../context.ts';
import type { CreateCollectionSchema, SaveLayout } from '../schemas/payloads.ts';
import { CollectionSchema } from '../schemas/responses.ts';

export async function readCollection(app: Hono<HonoEnvironment>, headers: Headers, id: string) {
  const response = await app.request(`/app-api/collections/${id}`, { headers });
  expect(response.status).toBe(200);

  return CollectionSchema.parse(await response.json());
}

export async function createTestCollection(
  app: Hono<HonoEnvironment>,
  headers: Headers,
  payload: z.input<typeof CreateCollectionSchema> = { name: 'Favorites' },
) {
  const response = await app.request('/app-api/collections', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  expect(response.status).toBe(201);

  return CollectionSchema.parse(await response.json());
}

export async function saveLayout(app: Hono<HonoEnvironment>, headers: Headers, id: string, layout: SaveLayout) {
  const response = await app.request(`/app-api/collections/${id}/layout`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(layout),
  });

  expect(response.status).toBe(200);

  return CollectionSchema.parse(await response.json());
}

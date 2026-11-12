import { drizzle } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

import { createTestCard, validCardPayload } from './utils.ts';
import { CollectionSchema } from '../../collections/schemas/responses.ts';
import { appRelations } from '../../db/schema/index.ts';
import { PostgresOfflineCollectionRepository } from '../../persistence/postgres/offline-collection.ts';
import { sessionHeaders } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { ManifestSchema, RecordsSchema } from '../schemas/offline-collection.ts';

const path = '/app-api/cards/offline';

describe('Offline collection integration', () => {
  integrationTest(
    'checks unchanged collections without a response body or provider requests',
    async ({ app, user, authenticatedHeaders, pricingClient }) => {
      const owned = await createTestCard(app, user.sessionToken, {
        ...validCardPayload,
        name: 'One Piece Card',
        card_number: 'OP14-069',
      });

      const search = vi.spyOn(pricingClient, 'searchCards');
      const lookup = vi.spyOn(pricingClient, 'getCardById');

      const first = await app.request(`${path}/manifest`, { headers: authenticatedHeaders });

      expect(first.status).toBe(200);
      const manifest = ManifestSchema.parse(await first.json());
      expect(manifest.entries).toContainEqual({ kind: 'card', id: owned.id, hash: expect.any(String) });
      const etag = z.string().parse(first.headers.get('ETag'));
      const conditionalHeaders = new Headers(authenticatedHeaders);
      conditionalHeaders.set('If-None-Match', etag);

      const unchanged = await app.request(`${path}/manifest`, { headers: conditionalHeaders });

      expect(unchanged.status).toBe(304);
      expect(await unchanged.text()).toBe('');
      expect(search).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();

      const records = await app.request(`${path}/records`, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify({ entries: manifest.entries }),
      });

      expect(records.status).toBe(200);

      const payload = RecordsSchema.parse(await records.json());

      expect(payload.cards).toMatchObject([
        { id: owned.id, price: { priced_card: { image_url: expect.any(String) } } },
      ]);
    },
  );

  integrationTest(
    'scopes records to the caller and rejects deleted or superseded entries',
    async ({ app, user, authenticatedHeaders, createUser }) => {
      const edited = await createTestCard(app, user.sessionToken);
      const deleted = await createTestCard(app, user.sessionToken, { ...validCardPayload, card_number: 'OP01-004' });
      const first = await app.request(`${path}/manifest`, { headers: authenticatedHeaders });
      expect(first.status).toBe(200);
      const initial = ManifestSchema.parse(await first.json());
      const other = await createUser();

      const foreign = await app.request(`${path}/records`, {
        method: 'POST',
        headers: sessionHeaders(other.sessionToken),
        body: JSON.stringify({ entries: initial.entries }),
      });

      expect(foreign.status).toBe(409);

      const edit = await app.request(`/app-api/cards/${edited.id}`, {
        method: 'PUT',
        headers: authenticatedHeaders,
        body: JSON.stringify({ ...validCardPayload, notes: 'Offline update' }),
      });

      expect(edit.status).toBe(200);

      const deletion = await app.request('/app-api/cards', {
        method: 'DELETE',
        headers: authenticatedHeaders,
        body: JSON.stringify({ card_ids: [deleted.id] }),
      });

      expect(deletion.status).toBe(200);

      const second = await app.request(`${path}/manifest`, { headers: authenticatedHeaders });
      expect(second.status).toBe(200);
      const changed = ManifestSchema.parse(await second.json());

      expect(changed.entries.filter(entry => entry.kind === 'card').map(entry => entry.id)).toEqual([edited.id]);
      expect(changed.entries.find(entry => entry.id === edited.id)).not.toEqual(
        initial.entries.find(entry => entry.id === edited.id),
      );

      const stale = await app.request(`${path}/records`, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify({ entries: initial.entries }),
      });

      expect(stale.status).toBe(409);
    },
  );

  integrationTest(
    'sends a changed binder layout with its slots and empty pages',
    async ({ app, user, authenticatedHeaders: headers }) => {
      const created = await app.request('/app-api/collections', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Trip binder' }),
      });

      expect(created.status).toBe(201);
      const binder = CollectionSchema.parse(await created.json());
      const owned = await createTestCard(app, user.sessionToken, { ...validCardPayload, collection_id: binder.id });
      const collectionPath = `/app-api/collections/${binder.id}`;
      const latest = await app.request(collectionPath, { headers });
      expect(latest.status).toBe(200);
      const { revision } = CollectionSchema.parse(await latest.json());

      const first = await app.request(`${path}/manifest`, { headers });
      expect(first.status).toBe(200);
      const initial = ManifestSchema.parse(await first.json());

      const pages = [
        { id: '00000000-0000-4000-8000-000000000001', slots: [{ row: 2, column: 1, card_id: owned.id, quantity: 2 }] },
        { id: '00000000-0000-4000-8000-000000000002', slots: [] },
      ];

      const layout = await app.request(`${collectionPath}/layout`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ revision, columns: 1, rows: 2, pages }),
      });

      expect(layout.status).toBe(200);

      const updated = await app.request(`${path}/manifest`, { headers });
      expect(updated.status).toBe(200);
      const manifest = ManifestSchema.parse(await updated.json());
      const entries = manifest.entries.filter(entry => entry.id === binder.id);
      expect(entries).toHaveLength(1);
      expect(entries).not.toEqual(initial.entries.filter(entry => entry.id === binder.id));

      const records = await app.request(`${path}/records`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ entries }),
      });

      expect(records.status).toBe(200);
      expect(await records.json()).toMatchObject({ cards: [], collections: [{ id: binder.id, pages }] });
    },
  );

  integrationTest(
    'reads a full snapshot in two selects and a card-only batch in one statement',
    async ({ app, db, user }) => {
      const owned = await createTestCard(app, user.sessionToken, validCardPayload);
      const logQuery = vi.fn<(query: string, parameters: unknown[]) => void>();
      const loggedDB = drizzle({ client: db.$client, relations: appRelations, logger: { logQuery } });
      const repository = new PostgresOfflineCollectionRepository(loggedDB, { requireUserId: () => user.userId });

      const snapshot = await repository.read(undefined);

      expect(snapshot.cards.map(({ owned }) => owned.id)).toContain(owned.id);
      expect(logQuery.mock.calls.filter(([query]) => query.startsWith('select'))).toHaveLength(2);
      logQuery.mockClear();

      const batch = await repository.read({ cards: [owned.id], collections: [] });

      expect(batch.cards.map(({ owned }) => owned.id)).toEqual([owned.id]);
      expect(batch.collections).toEqual([]);
      expect(logQuery).toHaveBeenCalledTimes(1);
    },
  );
});

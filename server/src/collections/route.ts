import { SERVER_MODES } from '@tcg/http/common';
import { openAPIRouterFactory } from '@tcg/http/open-api';

import type { HonoEnvironment } from '../context.ts';
import { allowedModes } from '../modes.ts';
import { createCollectionRouteDependencies } from './route-dependencies.ts';
import { createCollectionRoute } from './routes/create-collection.ts';
import { createDeleteCollectionRoute } from './routes/delete-collection.ts';
import { createExportCollectionsRoute } from './routes/export-collections.ts';
import { createGetCollectionRoute } from './routes/get-collection.ts';
import { createGetPageRoute } from './routes/get-page.ts';
import { createImportCollectionsRoute } from './routes/import-collections.ts';
import { createListCollectionsRoute } from './routes/list-collections.ts';
import { createPreviewImportRoute } from './routes/preview-import.ts';
import { createSaveLayoutRoute } from './routes/save-layout.ts';
import { createUpdateCollectionRoute } from './routes/update-collection.ts';
import type { CollectionPolicy } from './types.ts';

export function createCollectionsRoute(policy: CollectionPolicy) {
  const collectionsRoute = openAPIRouterFactory<HonoEnvironment>();
  const dependencies = createCollectionRouteDependencies(policy);

  collectionsRoute.use(allowedModes(SERVER_MODES.SERVER));
  collectionsRoute.openapiRoutes([
    createPreviewImportRoute(dependencies),
    createListCollectionsRoute(dependencies),
    createCollectionRoute(dependencies),
    createExportCollectionsRoute(dependencies),
    createImportCollectionsRoute(dependencies),
    createUpdateCollectionRoute(dependencies),
    createSaveLayoutRoute(dependencies),
    createDeleteCollectionRoute(dependencies),
    createGetPageRoute(dependencies),
    createGetCollectionRoute(dependencies),
  ]);

  return collectionsRoute;
}

import { SERVER_MODES } from '../constants/common.ts';
import { allowedModes } from '../modes.ts';
import { openAPIRouterFactory } from '../open-api.ts';
import createCardRoute from './routes/create-card.ts';
import deleteCardRoute from './routes/delete-card.ts';
import exportCardsRoute from './routes/export-cards.ts';
import importCardsRoute from './routes/import-cards.ts';
import listCardsRoute from './routes/list-cards.ts';
import updateCardRoute from './routes/update-card.ts';

const cardsRoute = openAPIRouterFactory();

cardsRoute.use(allowedModes(SERVER_MODES.SERVER));

cardsRoute.openapiRoutes([
  exportCardsRoute,
  importCardsRoute,
  createCardRoute,
  listCardsRoute,
  updateCardRoute,
  deleteCardRoute,
]);

export default cardsRoute;

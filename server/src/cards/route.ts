import { SERVER_MODES } from '../constants/common.ts';
import { allowedModes } from '../modes.ts';
import { openAPIRouterFactory } from '../open-api.ts';
import createCardRoute from './routes/create-card.ts';
import deleteCardRoute from './routes/delete-card.ts';
import listCardsRoute from './routes/list-cards.ts';
import updateCardRoute from './routes/update-card.ts';

const cardsRoute = openAPIRouterFactory();

cardsRoute.use(allowedModes(SERVER_MODES.SERVER));

cardsRoute.openapiRoutes([createCardRoute, listCardsRoute, updateCardRoute, deleteCardRoute]);

export default cardsRoute;

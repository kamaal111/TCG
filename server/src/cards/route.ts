import { SERVER_MODES } from '../constants/common.ts';
import { allowedModes } from '../modes.ts';
import { openAPIRouterFactory } from '../open-api.ts';
import createCardHandler from './handlers/create-card.ts';
import deleteCardHandler from './handlers/delete-card.ts';
import listCardsHandler from './handlers/list-cards.ts';
import updateCardHandler from './handlers/update-card.ts';
import createCardRoute from './routes/create-card.ts';
import deleteCardRoute from './routes/delete-card.ts';
import listCardsRoute from './routes/list-cards.ts';
import updateCardRoute from './routes/update-card.ts';

const cardsRoute = openAPIRouterFactory();

cardsRoute.use(allowedModes(SERVER_MODES.SERVER));

// POST: /
cardsRoute.openapi(createCardRoute, createCardHandler);

// GET: /
cardsRoute.openapi(listCardsRoute, listCardsHandler);

// PUT: /{cardId}
cardsRoute.openapi(updateCardRoute, updateCardHandler);

// DELETE: /{cardId}
cardsRoute.openapi(deleteCardRoute, deleteCardHandler);

export default cardsRoute;

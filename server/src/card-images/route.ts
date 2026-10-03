import { openAPIRouterFactory } from '../open-api.ts';
import getImageRoute from './routes/get-image.ts';

const imagesRoute = openAPIRouterFactory();

imagesRoute.openapiRoutes([getImageRoute]);

export default imagesRoute;

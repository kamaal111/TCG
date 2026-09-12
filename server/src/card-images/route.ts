import { openAPIRouterFactory } from '../open-api.ts';
import getImageHandler from './handlers/get-image.ts';
import getImageRoute from './routes/get-image.ts';

const imagesRoute = openAPIRouterFactory();
imagesRoute.openapi(getImageRoute, getImageHandler);

export default imagesRoute;

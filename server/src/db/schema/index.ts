export * from './better-auth.ts';
export * from './cards.ts';

import { authRelations } from './better-auth.ts';
import { cardsRelations } from './cards.ts';

export const appRelations = { ...authRelations, ...cardsRelations };

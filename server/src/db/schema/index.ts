import { authRelations } from './better-auth.ts';
import { cardsRelations } from './cards.ts';

export * from './better-auth.ts';
export * from './cards.ts';
export * from './card-pricing.ts';

export const appRelations = { ...authRelations, ...cardsRelations };

import { authRelations } from './better-auth.ts';
import { cardImageRelations } from './card-images.ts';
import { cardPricingRelations } from './card-pricing.ts';
import { cardsRelations } from './cards.ts';
import { forexRelations } from './forex.ts';

export * from './forex.ts';

export * from './better-auth.ts';

export * from './cards.ts';

export * from './card-pricing.ts';

export * from './card-images.ts';

export const appRelations = {
  ...forexRelations,
  ...authRelations,
  ...cardsRelations,
  ...cardPricingRelations,
  ...cardImageRelations,
};

import type { CardGame } from '../card-pricing/types.ts';
import type { HonoContext } from '../context.ts';
import { type DomainLogFields, type DomainLogger, getDomainLogger } from '../logging/index.ts';

export const CARDS_EVENTS = [
  'cards.create',
  'cards.list',
  'cards.update',
  'cards.delete',
  'cards.access_denied',
] as const;

export type CardsLogFields = DomainLogFields<(typeof CARDS_EVENTS)[number]> & {
  card_id?: string;
  result_count?: number;
  game?: CardGame;
};

export const cardsLogger = (c: HonoContext): DomainLogger<CardsLogFields> => getDomainLogger(c);

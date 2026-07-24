import type { CardGame, TCGGORawCard } from './types.ts';

export interface TCGGOClient {
  readonly source: 'static' | 'real';
  searchCards(game: CardGame, query: string): Promise<TCGGORawCard[]>;
  getCardById(game: CardGame, id: string): Promise<TCGGORawCard | null>;
}

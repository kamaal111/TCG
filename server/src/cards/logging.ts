import type { CardGame } from '../card-pricing/types.ts';
import type { HonoContext } from '../context.ts';
import { type DomainLogFields, type DomainLogger, getDomainLogger } from '../logging/index.ts';

export const CARDS_EVENTS = [
  'cards.create',
  'cards.export',
  'cards.import',
  'cards.import.validated',
  'cards.import.lock_acquired',
  'cards.import.ownership_resolved',
  'cards.import.batch_prepared',
  'cards.list',
  'cards.update',
  'cards.delete',
  'cards.access_denied',
] as const;

export type CardsLogFields = DomainLogFields<(typeof CARDS_EVENTS)[number]> & {
  card_id?: string;
  result_count?: number;
  skipped_count?: number;
  updated_count?: number;
  received_count?: number;
  unique_count?: number;
  owned_count?: number;
  new_count?: number;
  purchase_count?: number;
  batch_index?: number;
  batch_count?: number;
  transaction_status?: CardImportProgress['transactionStatus'];
  not_found_count?: number;
  game?: CardGame;
};

export const cardsLogger = (c: HonoContext): DomainLogger<CardsLogFields> => getDomainLogger(c);

export interface CardImportProgress {
  stage: 'validated' | 'lock_acquisition' | 'ownership_resolution' | 'batch_preparation' | 'commit' | 'completed';
  lastCompletedStage: 'validated' | 'lock_acquired' | 'ownership_resolved' | 'batch_prepared' | 'completed';
  transactionStatus: 'pending' | 'committed' | 'rolled_back';
}

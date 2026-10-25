import { IMPORT_CARD_EXAMPLE } from '../../cards/schemas/examples.ts';
import { COLLECTION_BACKUP_VERSION } from '../constants.ts';

export const BINDER_SLOT_EXAMPLE = {
  row: 1,
  column: 1,
  card_id: IMPORT_CARD_EXAMPLE.id,
  quantity: 2,
};

export const BINDER_PAGE_EXAMPLE = {
  id: '550e8400-e29b-41d4-a716-446655440020',
  slots: [BINDER_SLOT_EXAMPLE],
};

export const BINDER_LAYOUT_EXAMPLE = { columns: 1, rows: 4, pages: [BINDER_PAGE_EXAMPLE] };

export const COLLECTION_SUMMARY_EXAMPLE = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: 'Favorites',
  is_unfiled: false,
  revision: 0,
};

export const COLLECTION_EXAMPLE = { ...COLLECTION_SUMMARY_EXAMPLE, ...BINDER_LAYOUT_EXAMPLE };

export const COLLECTION_BACKUP_CARD_EXAMPLE = {
  ...IMPORT_CARD_EXAMPLE,
  collection_id: COLLECTION_SUMMARY_EXAMPLE.id,
};

export const COLLECTION_BACKUP_EXAMPLE = {
  version: COLLECTION_BACKUP_VERSION,
  collections: [COLLECTION_EXAMPLE],
  cards: [COLLECTION_BACKUP_CARD_EXAMPLE],
};

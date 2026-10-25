import type { HonoContext } from '../context.ts';
import { type DomainLogFields, type DomainLogger, getDomainLogger } from '../logging/index.ts';

type CollectionFields = DomainLogFields<
  | 'collections.create'
  | 'collections.update'
  | 'collections.layout'
  | 'collections.delete'
  | 'collections.export'
  | 'collections.import'
> & {
  collection_id?: string;
  result_count?: number;
};

export const collectionsLogger = (c: HonoContext): DomainLogger<CollectionFields> => getDomainLogger(c);

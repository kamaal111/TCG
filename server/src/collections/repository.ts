import type { z } from 'zod';

import type { BackupWriter } from './backup-stream.ts';
import type { SaveLayout, UpdateCollectionSchema } from './schemas/payloads.ts';
import type {
  Collection,
  CollectionSummary,
  CollectionBackup,
  ImportBackupResponseSchema,
  BackupPreviewSchema,
} from './schemas/responses.ts';
import type { CardWithPurchases } from '../cards/types.ts';

export interface CollectionRepository {
  list(): Promise<CollectionSummary[]>;
  get(id: string): Promise<Collection>;
  create(name: string): Promise<Collection>;
  update(id: string, values: z.infer<typeof UpdateCollectionSchema>): Promise<Collection>;
  save(id: string, values: SaveLayout): Promise<Collection>;
  delete(id: string): Promise<void>;
  page(id: string, pageId: string): Promise<{ cards: CardWithPurchases[] }>;
  exportTo(writer: BackupWriter, ids?: string[]): Promise<void>;
  preview(backup: CollectionBackup): Promise<z.infer<typeof BackupPreviewSchema>>;
  import(backup: CollectionBackup): Promise<z.infer<typeof ImportBackupResponseSchema>>;
}

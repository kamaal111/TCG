import type { CardImageMaterializationStatus, CardImageMaterializationTrigger } from './materializer.ts';
import type { HonoContext } from '../context.ts';
import { type DomainLogFields, type DomainLogger, getDomainLogger, getProcessLogger } from '../logging/index.ts';

export const IMAGES_EVENTS = [
  'images.register',
  'images.materialize.started',
  'images.origin_fetch.completed',
  'images.proxy.completed',
  'images.warm.queued',
  'images.warm.completed',
  'images.worker.started',
  'images.worker.stopped',
  'images.storage.completed',
] as const;

export type ImagesLogFields = DomainLogFields<(typeof IMAGES_EVENTS)[number]> & {
  image_key?: string;
  result_count?: number;
  cache_status?: 'cold' | 'hit' | 'joined' | 'miss' | 'set' | 'timeout';
  attempt?: number;
  content_length?: number;
  content_type?: string;
  is_retryable?: boolean;
  origin_status_code?: number;
  trigger?: CardImageMaterializationTrigger;
  materialization_status?: CardImageMaterializationStatus;
};

export const imagesLogger = (c: HonoContext): DomainLogger<ImagesLogFields> => getDomainLogger(c);
export const processImagesLogger = (): DomainLogger<ImagesLogFields> => getProcessLogger();

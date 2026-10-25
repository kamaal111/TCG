import { z } from 'zod';

import { UuidSchema } from '../../schemas/common.ts';

export const CollectionParamsSchema = z.object({ collectionId: UuidSchema });

export const PageParamsSchema = CollectionParamsSchema.extend({ pageId: UuidSchema });

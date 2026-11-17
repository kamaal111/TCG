import { z } from 'zod';

import { UuidSchema } from '../../schemas/common.ts';

export const SaveWishlistPrintingSchema = z.object({ priced_card_id: UuidSchema });

import { z } from 'zod';

import { CurrencySchema } from '../../forex/currencies.ts';

export const UpdatePreferencesSchema = z.object({
  preferred_currency: CurrencySchema,
  only_if_unset: z.boolean().optional(),
});

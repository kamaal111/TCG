import { z } from 'zod';

import { CurrencySchema } from '../../forex/currencies.ts';

export const CurrencyPreferencePayloadSchema = z.object({
  preferred_currency: CurrencySchema,
});

import {
  SessionResponseSchema as BaseSessionResponseSchema,
  UserSchema as BaseUserSchema,
} from '@kamaalio/kamaal-auth-hono';
import { z } from 'zod';

import { CurrencySchema } from '../../forex/currencies.ts';

export const SessionExtrasSchema = z.object({
  preferred_currency: CurrencySchema,
});

export const SessionResponseSchema = BaseSessionResponseSchema.extend({
  user: BaseUserSchema.extend(SessionExtrasSchema.shape),
});

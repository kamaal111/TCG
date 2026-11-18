import { z } from 'zod';

export const EnglishSearchAliasResponseSchema = z.object({
  translation: z.object({ en: z.object({ name: z.string().trim().nonempty() }) }),
});

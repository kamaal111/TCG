import { z } from 'zod';

import { FOREX_BASE_CURRENCY } from '../constants.ts';

export const ForexSnapshotSchema = z
  .object({
    base: z.literal(FOREX_BASE_CURRENCY),
    date: z.iso.date(),
    rates: z
      .record(z.string(), z.number().positive())
      .refine(rates => rates.EUR === 1 && rates.USD != null && rates.JPY != null),
  })
  .meta({ $id: 'ForexSnapshot', title: 'Forex Snapshot' });

export type ForexSnapshot = z.infer<typeof ForexSnapshotSchema>;

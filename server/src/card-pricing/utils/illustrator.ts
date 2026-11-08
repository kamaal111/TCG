import z from 'zod';

import type { CardPriceRow } from '../types.ts';

export const IllustratorNameSchema = z.string().trim().nonempty();

const MetadataSchema = z.object({ artist: IllustratorNameSchema.optional().catch(undefined) });

export function cachedIllustrator(row: Pick<CardPriceRow, 'prices' | 'raw'>): string | undefined {
  const parsed = IllustratorNameSchema.safeParse(row.prices.illustrator);
  const metadata = MetadataSchema.safeParse(row.raw);

  return parsed.success ? parsed.data : metadata.data?.artist;
}

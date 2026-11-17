import { sha256Hex } from '@tcg/crypto/sha256';

export function printingKey(row: { pricingSource: string; game: string; pricingCardId: string }): string {
  return sha256Hex(JSON.stringify([row.pricingSource, row.game, row.pricingCardId]));
}

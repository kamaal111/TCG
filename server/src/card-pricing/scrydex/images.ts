import type { ScrydexRawCard } from '@tcg/scrydex';

export function frontCardImage(images: ScrydexRawCard['images']) {
  return images?.find(image => image.type === 'front') ?? images?.[0];
}

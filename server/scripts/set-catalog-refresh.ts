import { InternalServerError } from '@tcg/http/exceptions';
import { SCRYDEX_CATALOG_COLLECTION_MAP, type ScrydexClient, type ScrydexRawCard } from '@tcg/scrydex';
import { z } from 'zod';

import { catalogPages } from './catalog-pages.ts';
import { catalogExpansions, catalogPrintings } from '../src/card-pricing/catalog-metadata.ts';
import { frontCardImage } from '../src/card-pricing/scrydex/images.ts';
import { splitScrydexPricingId } from '../src/card-pricing/scrydex/normalize.ts';
import { CARD_GAME_MAP, PRICING_SOURCES } from '../src/card-pricing/types.ts';
import { readEnglishSearchAlias } from '../src/card-pricing/utils/english-search-alias.ts';
import { SetExpansionSchema, SetPrintingSchema, type SetExpansion, type SetPrinting } from '../src/sets/catalog.ts';

const TextSchema = z.string().trim().nonempty();

function frontImage(images: ScrydexRawCard['images']) {
  const front = frontCardImage(images);

  return front?.small ?? front?.medium ?? front?.large;
}

export async function fetchSetInventory(client: ScrydexClient, budget: number) {
  const pages = catalogPages(budget);
  const expansions: SetExpansion[] = [];
  const printings: SetPrinting[] = [];
  let numberless = 0;

  for (const game of Object.values(CARD_GAME_MAP)) {
    const rawExpansions = await pages.fetchScope(page => {
      return client.listSetCatalog(game, SCRYDEX_CATALOG_COLLECTION_MAP.EXPANSIONS, page);
    });

    const expansionIndex = catalogExpansions(rawExpansions);

    for (const raw of rawExpansions) {
      const alias = readEnglishSearchAlias({ game, pricingSource: PRICING_SOURCES.SCRYDEX_REAL, raw });
      expansions.push(
        SetExpansionSchema.parse({
          game,
          id: TextSchema.parse(raw.id).toLowerCase(),
          name: raw.name,
          aliases: alias == null ? [] : [alias],
          code: raw.code,
          language: TextSchema.safeParse(raw.language_code).data?.toLowerCase(),
          releaseDate: TextSchema.safeParse(raw.release_date).data?.replaceAll('/', '-'),
          logo: raw.logo,
          symbol: raw.symbol,
        }),
      );
    }

    const rawCards = await pages.fetchScope(page => {
      return client.listSetCatalog(game, SCRYDEX_CATALOG_COLLECTION_MAP.CARDS, page);
    });

    for (const raw of rawCards) {
      if (!TextSchema.safeParse(raw.number).success && !TextSchema.safeParse(raw.printed_number).success) {
        numberless += 1;
        continue;
      }

      const rows = catalogPrintings(game, PRICING_SOURCES.SCRYDEX_REAL, raw, expansionIndex);

      if (rows.length === 0) {
        throw new InternalServerError(undefined, {
          diagnosticMessage: `Catalog card ${game}/${TextSchema.parse(raw.id)} had no usable printing`,
        });
      }

      for (const row of rows) {
        // Some provider cards have no expansion and cannot fill a set checklist slot.
        if (row.setKey === '') {
          continue;
        }

        const { variantName } = splitScrydexPricingId(game, row.pricingId);

        const variant = raw.variants?.find(entry => {
          return variantName != null && TextSchema.safeParse(entry.name).data?.toLowerCase() === variantName;
        });

        printings.push(
          SetPrintingSchema.parse({
            game,
            setId: row.setKey,
            pricingId: row.pricingId,
            number: game === CARD_GAME_MAP.ONE_PIECE ? row.printedNumber.toUpperCase() : row.collectorNumber,
            name: raw.name,
            printedNumber: row.printedNumber,
            image: frontImage(variant?.images) ?? frontImage(raw.images),
          }),
        );
      }
    }
  }

  return { inventory: { expansions, printings }, requests: pages.requests, numberless };
}

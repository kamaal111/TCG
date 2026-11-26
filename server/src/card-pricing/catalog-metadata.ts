import type { ScrydexRawCard } from '@tcg/scrydex';
import { z } from 'zod';

import { catalogTerms } from './catalog-query.ts';
import type { CatalogPrinting } from './catalog.ts';
import { normalizeScrydexSearch } from './scrydex/normalize.ts';
import { CARD_GAME_MAP, type CardGame, type PricingSource } from './types.ts';
import { readEnglishSearchAlias } from './utils/english-search-alias.ts';
import { normalizeCollectorNumber } from './utils/identifiers.ts';
import { normalizeCardNumber } from './utils/query.ts';

const TextSchema = z.string().trim().nonempty();
const OptionalTextSchema = TextSchema.optional().catch(undefined);

const ExpansionSchema = z.object({
  id: TextSchema,
  name: TextSchema,
  code: OptionalTextSchema,
  translation: z.unknown().optional(),
});

const CardSchema = z.object({
  id: TextSchema,
  name: TextSchema,
  language_code: TextSchema,
  number: OptionalTextSchema,
  printed_number: OptionalTextSchema,
  expansion: ExpansionSchema.optional().catch(undefined),
});

const PrintingCodesSchema = z.array(TextSchema).optional().catch(undefined);

type Expansion = z.infer<typeof ExpansionSchema>;

export function catalogExpansions(raw: readonly ScrydexRawCard[]): Map<string, Expansion> {
  const expansions = new Map<string, Expansion>();

  for (const entry of raw) {
    const expansion = ExpansionSchema.parse(entry);

    for (const key of [expansion.code, expansion.id]) {
      if (key != null) {
        expansions.set(key.toLowerCase(), expansion);
      }
    }
  }

  return expansions;
}

export function catalogPrintings(
  game: CardGame,
  source: PricingSource,
  raw: ScrydexRawCard,
  expansions: ReadonlyMap<string, Expansion>,
): CatalogPrinting[] {
  const metadata = CardSchema.parse(raw);
  const translatedName = readEnglishSearchAlias({ game, pricingSource: source, raw });
  const names = [metadata.name, ...(translatedName == null ? [] : [translatedName])];
  const nameTokens = [...new Set(names.flatMap(catalogTerms))];

  const { records } = normalizeScrydexSearch(game, [raw], {
    providerResultCount: 1,
    hasMore: false,
    rejectedCount: 0,
  });

  const baseExpansion = metadata.expansion;

  const catalogBase =
    baseExpansion != null ? (expansions.get(baseExpansion.id.toLowerCase()) ?? baseExpansion) : undefined;

  return records.flatMap(({ card }) => {
    const variantName = card.pricing.variantName?.toLowerCase();

    const variant =
      variantName != null
        ? raw.variants?.find(entry => TextSchema.safeParse(entry.name).data?.toLowerCase() === variantName)
        : undefined;

    const variantSets = PrintingCodesSchema.parse(variant?.printings);
    const setKeys = game === CARD_GAME_MAP.ONE_PIECE && variantSets?.length ? variantSets : [catalogBase?.id ?? ''];
    const sets = new Map<string, CatalogPrinting>();

    for (const code of setKeys) {
      const expansion = expansions.get(code.toLowerCase()) ?? (code === catalogBase?.id ? catalogBase : undefined);
      const setName = expansion?.name ?? (code.length > 0 ? code : undefined);
      const setAlias = readEnglishSearchAlias({ game, pricingSource: source, raw: expansion });

      const setIds = [
        ...new Set([code, expansion?.id, expansion?.code].flatMap(id => (id == null ? [] : [id.toLowerCase()]))),
      ];

      const setTokens = [...new Set([setName ?? '', setAlias ?? '', ...setIds].flatMap(catalogTerms))];
      const setKey = expansion?.id.toLowerCase() ?? code.toLowerCase();

      sets.set(setKey, {
        game,
        providerId: metadata.id,
        pricingId: card.id,
        language: metadata.language_code.toLowerCase(),
        names: names.map(name => catalogTerms(name).join(' ')),
        nameTokens,
        setTokens,
        setIds,
        setKey,
        setName,
        primarySet: setKey === (catalogBase?.id.toLowerCase() ?? ''),
        collectorNumber: normalizeCollectorNumber(normalizeCardNumber(metadata.number ?? card.cardNumber)),
        printedNumber: normalizeCardNumber(metadata.printed_number ?? card.cardNumber),
      });
    }

    return [...sets.values()];
  });
}

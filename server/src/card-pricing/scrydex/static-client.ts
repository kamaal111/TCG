import { SCRYDEX_SEARCH_PAGE_SIZE, type ScrydexRawCard } from '@tcg/scrydex';
import { ok } from 'neverthrow';

import type { PricingClient, PricingClientResult, PricingSearchResult } from '../client.ts';
import { normalizeCardLanguages } from '../languages.ts';
import {
  CARD_GAME_MAP,
  type CardGame,
  type PricingCardRecord,
  type PricingSearchOptions,
  PRICING_SOURCES,
} from '../types.ts';
import { normalizeScrydexLookup, normalizeScrydexSearch, splitScrydexPricingId } from './normalize.ts';
import { IllustratorNameSchema } from '../utils/illustrator.ts';

const CANNED_CARDS: Record<CardGame, ScrydexRawCard[]> = {
  [CARD_GAME_MAP.POKEMON]: [
    {
      id: 'crown-zenith-GG69',
      expansion: { name: 'Crown Zenith' },
      name: 'Giratina VSTAR',
      artist: 'Akira Egawa',
      language_code: 'EN',
      number: 'GG69',
      rarity: 'Secret Rare',
      images: [{ type: 'front', large: 'https://images.example.com/giratina-vstar-gg69.png' }],
      variants: [
        {
          name: 'normal',
          prices: [
            {
              condition: 'NM',
              type: 'raw',
              currency: 'USD',
              low: 146.69,
              market: 172.42,
              trends: {
                days_7: { price_change: 7.36, percent_change: 4.46 },
                days_30: { price_change: 13.88, percent_change: 8.75 },
              },
            },
          ],
        },
      ],
    },
    {
      id: 'sv3pt5-199',
      expansion: { name: '151' },
      name: 'Charizard ex',
      language_code: 'EN',
      number: '199',
      rarity: 'Special Illustration Rare',
      variants: [
        {
          name: 'normal',
          prices: [
            {
              condition: 'NM',
              type: 'raw',
              currency: 'USD',
              low: 98.5,
              market: 118.32,
              trends: {
                days_7: { price_change: -2.5, percent_change: -2.07 },
                days_30: { price_change: 1.25, percent_change: 1.07 },
              },
            },
          ],
        },
      ],
    },
  ],
  [CARD_GAME_MAP.ONE_PIECE]: [
    {
      id: 'OP14-069',
      expansion: { name: 'The Azure Sea’s Seven' },
      name: 'One Piece Card',
      number: '069',
      printed_number: 'OP14-069',
      rarity: 'Rare',
      language_code: 'EN',
      images: [{ type: 'front', large: 'https://images.example.com/one-piece-op14-069.png' }],
      variants: [
        {
          name: 'normal',
          prices: [
            {
              condition: 'NM',
              type: 'raw',
              currency: 'USD',
              low: 12.45,
              market: 14.2,
              trends: {
                days_7: { price_change: 0.7, percent_change: 5.19 },
                days_30: { price_change: -0.3, percent_change: -2.07 },
              },
            },
          ],
        },
      ],
    },
    {
      id: 'OP09-093',
      expansion: { name: 'Emperors in the New World' },
      name: 'Marshall.D.Teach',
      number: '093',
      printed_number: 'OP09-093',
      rarity: 'Super Rare',
      language_code: 'EN',
      variants: [
        {
          name: 'normal',
          prices: [
            {
              condition: 'NM',
              type: 'raw',
              currency: 'USD',
              low: 8.75,
              market: 9.6,
              trends: {
                days_7: { price_change: 0.1, percent_change: 1.05 },
                days_30: { price_change: 0.85, percent_change: 9.71 },
              },
            },
          ],
        },
        {
          name: 'mangaAltArt',
          prices: [{ condition: 'NM', type: 'raw', currency: 'USD', low: 734.9, market: 845.1 }],
        },
      ],
    },
  ],
};

export class StaticScrydexClient implements PricingClient {
  readonly source = PRICING_SOURCES.SCRYDEX_STATIC;

  async searchCards(
    game: CardGame,
    query: string,
    options: PricingSearchOptions,
    page: number,
  ): Promise<PricingClientResult<PricingSearchResult>> {
    const normalized = query.trim().toLowerCase();

    if (normalized.includes('no results')) {
      return ok(emptySearchResult());
    }

    const matches = CANNED_CARDS[game].filter(card => {
      const haystack =
        options.searchBy === 'illustrator'
          ? IllustratorNameSchema.catch('').parse(card.artist).toLowerCase()
          : `${String(card.name)} ${String(card.number)} ${String(card.printed_number)}`.toLowerCase();

      return normalized.split(/\s+/).every(term => haystack.includes(term));
    });

    const rawCards =
      matches.length > 0 || options.searchBy === 'illustrator' ? matches : [makeSyntheticCard(game, query)];

    const selected = normalizeCardLanguages(game, options.languages);

    const filtered = rawCards.filter(
      card => selected.length === 0 || selected.some(code => card.language_code === code.toUpperCase()),
    );

    const end = page * SCRYDEX_SEARCH_PAGE_SIZE;
    const pageCards = filtered.slice(end - SCRYDEX_SEARCH_PAGE_SIZE, end);

    return ok(
      normalizeScrydexSearch(game, pageCards, {
        providerResultCount: filtered.length,
        hasMore: end < filtered.length,
        rejectedCount: 0,
      }),
    );
  }

  async getCardById(game: CardGame, id: string): Promise<PricingClientResult<PricingCardRecord | null>> {
    const { providerId, variantName } = splitScrydexPricingId(game, id);
    const raw = CANNED_CARDS[game].find(card => card.id === providerId);

    if (raw == null) {
      return ok(null);
    }

    const normalized = normalizeScrydexLookup(game, raw, variantName);

    return ok(normalized != null ? { card: normalized.card, raw } : null);
  }
}

function emptySearchResult(): PricingSearchResult {
  return { records: [], providerResultCount: 0, hasMore: false, rejectedCount: 0, missingBaseVariantCount: 0 };
}

function makeSyntheticCard(game: CardGame, query: string): ScrydexRawCard {
  const normalized = query.trim().replace(/\s+/g, ' ');
  const hash = stableHash(`${game}|${normalized.toLowerCase()}`);
  const amount = Number((5 + (hash % 20_000) / 100).toFixed(2));
  const terms = normalized.split(' ');
  const possibleNumber = terms.at(-1) ?? `${hash % 999}`;
  const hasNumber = /\d/.test(possibleNumber);
  const cardNumber = hasNumber ? possibleNumber.toUpperCase() : `${hash % 999}`;
  const name = (hasNumber ? terms.slice(0, -1).join(' ') : normalized) || 'Static card';
  const id = `static-${game}-${slug(`${name}-${cardNumber}`)}`;

  const card: ScrydexRawCard = {
    id,
    name,
    language_code: 'EN',
    number: cardNumber,
    rarity: hash % 2 === 0 ? 'Rare' : undefined,
    variants: [
      {
        name: 'normal',
        prices: [
          {
            condition: 'NM',
            type: 'raw',
            currency: 'USD',
            low: amount,
            market: Number((amount * 1.08).toFixed(2)),
            trends: {
              days_7: { price_change: Number((amount * 0.02).toFixed(2)), percent_change: 2 },
              days_30: { price_change: Number((amount * -0.01).toFixed(2)), percent_change: -1 },
            },
          },
        ],
      },
    ],
  };

  if (game === CARD_GAME_MAP.ONE_PIECE) {
    card.printed_number = cardNumber;
  }

  return card;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;

  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

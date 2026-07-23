import { ok } from 'neverthrow';

import type { PricingClient, PricingClientResult, PricingSearchResult } from '../client.ts';
import { CARD_GAME_MAP, type CardGame, type PricingCardRecord, PRICING_SOURCES } from '../types.ts';
import { normalizeScrydexCard } from './normalize.ts';
import { type ScrydexRawCard, ScrydexRawCardSchema } from './types.ts';

const CANNED_CARDS: Record<CardGame, ScrydexRawCard[]> = {
  [CARD_GAME_MAP.POKEMON]: [
    {
      id: 'crown-zenith-GG69',
      name: 'Giratina VSTAR',
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
      name: 'Charizard ex',
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

  async searchCards(game: CardGame, query: string): Promise<PricingClientResult<PricingSearchResult>> {
    const normalized = query.trim().toLowerCase();
    if (normalized.includes('no results')) return ok(emptySearchResult());

    const matches = CANNED_CARDS[game].filter(card => {
      const haystack = `${String(card.name)} ${String(card.number)} ${String(card.printed_number)}`.toLowerCase();
      return normalized.split(/\s+/).every(term => haystack.includes(term));
    });
    const rawCards = matches.length > 0 ? matches : [makeSyntheticCard(game, query)];
    return ok(makeSearchResult(game, rawCards));
  }

  async getCardById(game: CardGame, id: string): Promise<PricingClientResult<PricingCardRecord | null>> {
    const raw = CANNED_CARDS[game].find(card => card.id === id);
    if (raw == null) return ok(null);
    return ok(makeRecord(game, raw));
  }
}

function emptySearchResult(): PricingSearchResult {
  return { records: [], providerResultCount: 0, rejectedCount: 0, missingBaseVariantCount: 0 };
}

function makeSearchResult(game: CardGame, rawCards: ScrydexRawCard[]): PricingSearchResult {
  const records = rawCards.flatMap(raw => {
    const record = makeRecord(game, raw);
    return record == null ? [] : [record];
  });
  return {
    records,
    providerResultCount: rawCards.length,
    rejectedCount: rawCards.length - records.length,
    missingBaseVariantCount: records.filter(record => record.card.pricing.market == null).length,
  };
}

function makeRecord(game: CardGame, value: unknown): PricingCardRecord | null {
  const parsed = ScrydexRawCardSchema.safeParse(value);
  if (!parsed.success) return null;
  const normalized = normalizeScrydexCard(game, parsed.data);
  return normalized == null ? null : { card: normalized.card, raw: parsed.data };
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

  return {
    id,
    name,
    number: cardNumber,
    ...(game === CARD_GAME_MAP.ONE_PIECE ? { printed_number: cardNumber } : {}),
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

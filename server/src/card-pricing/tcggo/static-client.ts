import type { TCGGOClient } from './client.ts';
import type { CardGame, TCGGORawCard } from './types.ts';

const CANNED_CARDS: Record<CardGame, TCGGORawCard[]> = {
  pokemon: [
    {
      id: 'pokemon-giratina-vstar-gg69',
      name: 'Giratina VSTAR',
      card_number: 'GG69',
      rarity: 'Secret Rare',
      image: 'https://images.example.com/giratina-vstar-gg69.png',
      prices: {
        cardmarket: {
          currency: 'EUR',
          lowest_near_mint: 146.69,
          '7d_average': 151.24,
          '30d_average': 143.88,
          graded: { psa_10: 325 },
        },
        tcg_player: { currency: 'USD', market_price: 172.42, mid_price: 178.1 },
        ebay: { currency: 'USD', last_sold: 169.99 },
      },
    },
    {
      id: 'pokemon-charizard-ex-199',
      name: 'Charizard ex',
      card_number: '199',
      rarity: 'Special Illustration Rare',
      image: 'https://images.example.com/charizard-ex-199.png',
      prices: {
        cardmarket: {
          currency: 'EUR',
          lowest_near_mint: 98.5,
          '7d_average': 97.25,
          '30d_average': 99.75,
        },
        tcgplayer: { currency: 'USD', market_price: 118.32 },
      },
    },
  ],
  one_piece: [
    {
      id: 'one-piece-marshall-d-teach-op09-093',
      name: 'Marshall.D.Teach',
      card_number: 'OP09-093',
      rarity: 'Manga Rare',
      image: 'https://images.example.com/marshall-d-teach-op09-093.png',
      prices: {
        cardmarket: {
          currency: 'EUR',
          lowest_near_mint: 734.9,
          '7d_average': 748.2,
          '30d_average': 720.4,
        },
        tcgplayer: { currency: 'USD', market_price: 845.1, mid_price: 870 },
      },
    },
  ],
};

export class StaticTCGGOClient implements TCGGOClient {
  readonly source = 'static' as const;

  async searchCards(game: CardGame, query: string): Promise<TCGGORawCard[]> {
    const normalized = query.trim().toLowerCase();
    if (normalized.includes('no results')) return [];

    const matches = CANNED_CARDS[game].filter(card => {
      const haystack = `${String(card.name)} ${String(card.card_number)}`.toLowerCase();
      return normalized.split(/\s+/).every(term => haystack.includes(term));
    });
    if (matches.length > 0) return matches;

    return [makeSyntheticCard(game, query)];
  }

  async getCardById(game: CardGame, id: string): Promise<TCGGORawCard | null> {
    const canned = CANNED_CARDS[game].find(card => card.id === id);
    if (canned != null) return canned;
    if (!id.startsWith(`static-${game}-`)) return null;

    return makeSyntheticCard(game, id.replace(`static-${game}-`, '').replaceAll('-', ' '), id);
  }
}

function makeSyntheticCard(game: CardGame, query: string, forcedId?: string): TCGGORawCard {
  const normalized = query.trim().replace(/\s+/g, ' ');
  const hash = stableHash(`${game}|${normalized.toLowerCase()}`);
  const amount = Number((5 + (hash % 20_000) / 100).toFixed(2));
  const terms = normalized.split(' ');
  const possibleNumber = terms.at(-1) ?? `${hash % 999}`;
  const hasNumber = /\d/.test(possibleNumber);
  const cardNumber = hasNumber ? possibleNumber.toUpperCase() : `${hash % 999}`;
  const name = (hasNumber ? terms.slice(0, -1).join(' ') : normalized) || 'Static card';
  const id = forcedId ?? `static-${game}-${slug(`${name}-${cardNumber}`)}`;

  return {
    id,
    name,
    card_number: cardNumber,
    rarity: hash % 2 === 0 ? 'Rare' : undefined,
    prices: {
      cardmarket: {
        currency: 'EUR',
        lowest_near_mint: amount,
        '7d_average': Number((amount * 1.02).toFixed(2)),
        '30d_average': Number((amount * 0.98).toFixed(2)),
      },
      ...(game === 'pokemon'
        ? { tcg_player: { currency: 'USD', market_price: Number((amount * 1.1).toFixed(2)) } }
        : { tcgplayer: { currency: 'USD', mid_price: Number((amount * 1.15).toFixed(2)) } }),
    },
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

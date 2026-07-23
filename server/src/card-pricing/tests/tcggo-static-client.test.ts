import { normalizeTCGGOCard } from '../tcggo/normalize.ts';
import { StaticTCGGOClient } from '../tcggo/static-client.ts';

describe('StaticTCGGOClient', () => {
  it('returns accurate canned Cardmarket pricing', async () => {
    const [raw] = await new StaticTCGGOClient().searchCards('pokemon', 'Giratina VSTAR GG69');
    const card = raw == null ? null : normalizeTCGGOCard(raw);

    expect(card).toMatchObject({
      id: 'pokemon-giratina-vstar-gg69',
      name: 'Giratina VSTAR',
      cardNumber: 'GG69',
      pricing: {
        cardmarket: {
          currency: 'EUR',
          lowestNearMint: 146.69,
          average7d: 151.24,
          average30d: 143.88,
        },
        tcgplayer: { currency: 'USD', marketPrice: 172.42 },
      },
    });
  });

  it('normalizes the One Piece tcgplayer spelling variance', async () => {
    const [raw] = await new StaticTCGGOClient().searchCards('one_piece', 'Marshall.D.Teach OP09-093');
    const card = raw == null ? null : normalizeTCGGOCard(raw);

    expect(card?.pricing.tcgplayer).toEqual({
      currency: 'USD',
      marketPrice: 845.1,
      midPrice: 870,
    });
  });

  it('returns deterministic partial synthetic pricing for unknown cards', async () => {
    const client = new StaticTCGGOClient();
    const first = await client.searchCards('one_piece', 'Nami OP01-016');
    const second = await client.searchCards('one_piece', 'Nami OP01-016');
    const normalized = first[0] == null ? null : normalizeTCGGOCard(first[0]);

    expect(first).toEqual(second);
    expect(normalized).toMatchObject({
      name: 'Nami',
      cardNumber: 'OP01-016',
      pricing: {
        cardmarket: { currency: 'EUR' },
        tcgplayer: { currency: 'USD' },
      },
    });
    expect(normalized?.pricing.tcgplayer?.marketPrice).toBeUndefined();
  });

  it('can model a no-results response without external I/O', async () => {
    await expect(new StaticTCGGOClient().searchCards('pokemon', 'no results')).resolves.toEqual([]);
  });
});

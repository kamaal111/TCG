import { NotFound, ServiceUnavailable } from '@tcg/http/exceptions';

import type { SetExpansion } from './catalog.ts';
import { matchesSet, setChecklists } from './checklist.ts';
import { SET_CHECKLIST_FILTER_MAP, SET_LIST_SECTION_MAP } from './constants.ts';
import { displayPricingResults } from '../card-pricing/display-results.ts';
import type { CardGame } from '../card-pricing/types.ts';
import type { HonoContext } from '../context.ts';
import { serializePage } from '../schemas/pagination.ts';
import type { ChecklistQuery, SetCardPath, SetListQuery, SetPath } from './schemas/params.ts';
import { setPage } from './utils/pagination.ts';

export class SetsService {
  private readonly c: HonoContext;

  constructor(c: HonoContext) {
    this.c = c;
  }

  async list({ game, query: requestedQuery, section: requestedSection, cursor }: SetListQuery) {
    const query = requestedQuery ?? '';
    const section = requestedSection ?? SET_LIST_SECTION_MAP.ALL;
    const { catalog, checklists } = this.catalogForGame(game);
    const owned = await this.ownedSlots(game, checklists);
    const totals = new Map<string, number>();

    for (const slot of owned) {
      totals.set(slot.setId, (totals.get(slot.setId) ?? 0) + 1);
    }

    const scope = JSON.stringify(['sets', catalog.version, game, query, section]);

    const { entries, nextCursor } = setPage(this.c, scope, cursor, checklists.ordered, ({ expansion, slots }) => {
      const collected = totals.get(expansion.id) ?? 0;

      return (
        matchesSet(expansion, query) &&
        (section === SET_LIST_SECTION_MAP.ALL || (collected > 0 && collected < slots.length))
      );
    });

    const summaries = entries.map(({ expansion, slots }) => {
      return summarize(expansion, totals.get(expansion.id) ?? 0, slots.length);
    });

    return serializePage(summaries, nextCursor);
  }

  async checklist({ game, set_id }: SetPath, { filter: requestedFilter, cursor }: ChecklistQuery) {
    const filter = requestedFilter ?? SET_CHECKLIST_FILTER_MAP.ALL;
    const { catalog, checklists } = this.catalogForGame(game);
    const checklist = checklists.byId.get(set_id.toLowerCase());

    if (checklist == null) {
      throw new NotFound(this.c);
    }

    const owned = await this.ownedSlots(game, checklists);
    const scope = JSON.stringify(['checklist', catalog.version, game, checklist.expansion.id, filter]);

    const { entries, nextCursor } = setPage(this.c, scope, cursor, checklist.slots, slot => {
      return filter === SET_CHECKLIST_FILTER_MAP.ALL || (filter === SET_CHECKLIST_FILTER_MAP.OWNED) === owned.has(slot);
    });

    return {
      ...serializePage(
        entries.flatMap(slot => {
          const printing = slot.printings[0];

          return printing == null
            ? []
            : [
                {
                  number: slot.number,
                  printed_number: printing.printedNumber,
                  name: printing.name,
                  image_url: printing.image ?? undefined,
                  owned: owned.has(slot),
                },
              ];
        }),
        nextCursor,
      ),
      set: summarize(
        checklist.expansion,
        checklist.slots.filter(slot => owned.has(slot)).length,
        checklist.slots.length,
      ),
    };
  }

  async cardDetail({ game, set_id, number }: SetCardPath) {
    const { checklists } = this.catalogForGame(game);
    const slot = checklists.byId.get(set_id.toLowerCase())?.slots.find(candidate => candidate.number === number);

    if (slot == null) {
      throw new NotFound(this.c);
    }

    const pricing = this.c.get('cardPricingService');

    const [prices, display] = await Promise.all([
      Promise.all(slot.printings.map(printing => pricing.priceSetPrinting(game, printing.pricingId))),
      this.c.get('forexService').displayContext(),
    ]);

    if (display.isErr()) {
      throw display.error;
    }

    const printings = await displayPricingResults(
      this.c,
      game,
      prices.filter(price => price != null),
      display.value,
    );

    return { printings };
  }

  private catalogForGame(game: CardGame) {
    const catalog = this.c.get('cardCatalog');
    const inventory = catalog?.setInventory(game);

    if (catalog == null || inventory == null) {
      throw new ServiceUnavailable(this.c, {
        code: 'SET_CATALOG_UNAVAILABLE',
        message: 'Set catalog is unavailable',
      });
    }

    return { catalog, checklists: setChecklists(inventory) };
  }

  private async ownedSlots(game: CardGame, checklists: ReturnType<typeof setChecklists>) {
    return checklists.ownedSlots(game, await this.c.get('cardRepository').listSetOwnership(game));
  }
}

function summarize(expansion: SetExpansion, collected: number, total: number) {
  return {
    id: expansion.id,
    name: expansion.name,
    code: expansion.code ?? undefined,
    logo: expansion.logo ?? undefined,
    symbol: expansion.symbol ?? undefined,
    language: expansion.language ?? undefined,
    release_date: expansion.releaseDate ?? undefined,
    collected,
    total,
  };
}

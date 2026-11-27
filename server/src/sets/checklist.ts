import { setCollectorNumber, type SetExpansion, type SetInventory, type SetPrinting } from './catalog.ts';
import { PRICING_SOURCES, type CardGame } from '../card-pricing/types.ts';
import { printingKey } from '../card-pricing/utils/printing-key.ts';
import type { SetOwnershipCard } from '../cards/repository.ts';

const byNumber = new Intl.Collator('en', { numeric: true });
const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

export interface Slot {
  setId: string;
  number: string;
  printings: readonly SetPrinting[];
}

interface Checklist {
  expansion: SetExpansion;
  slots: readonly Slot[];
}

function setAliases(set: SetExpansion) {
  return [set.id, set.name, set.code ?? '', ...set.aliases].values().filter(Boolean).map(normalize).toArray();
}

function compareSets(a: SetExpansion, b: SetExpansion) {
  return (
    (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
}

const inventories = new WeakMap<SetInventory, SetChecklists>();

export function setChecklists(inventory: SetInventory) {
  const cached = inventories.get(inventory);

  if (cached != null) {
    return cached;
  }

  const checklists = new SetChecklists(inventory);
  inventories.set(inventory, checklists);

  return checklists;
}

class SetChecklists {
  readonly ordered: readonly Checklist[];
  readonly byId: ReadonlyMap<string, Checklist>;
  private readonly byPricingId = new Map<string, Slot[]>();
  private readonly byAliasAndNumber = new Map<string, Set<Slot>>();
  private readonly byPrintingKey = new Map<string, readonly Slot[]>();

  constructor({ expansions, printings }: SetInventory) {
    const byExpansion = Map.groupBy(printings, printing => printing.setId);
    this.ordered = expansions.toSorted(compareSets).map(expansion => {
      const aliases = setAliases(expansion);

      const byCollectorNumber = Map.groupBy(byExpansion.get(expansion.id) ?? [], printing => {
        return setCollectorNumber(expansion.game, printing.number);
      });

      const slots = Array.from(byCollectorNumber, ([number, variants]): Slot => ({
        setId: expansion.id,
        number,
        printings: variants.toSorted((a, b) => a.pricingId.localeCompare(b.pricingId)),
      })).sort((a, b) => byNumber.compare(a.number, b.number) || a.number.localeCompare(b.number));

      for (const slot of slots) {
        for (const printing of slot.printings) {
          const matches = this.byPricingId.get(printing.pricingId) ?? [];
          matches.push(slot);
          this.byPricingId.set(printing.pricingId, matches);
          this.byPrintingKey.set(
            printingKey({
              game: expansion.game,
              pricingSource: PRICING_SOURCES.SCRYDEX_REAL,
              pricingCardId: printing.pricingId,
            }),
            matches,
          );
        }

        for (const alias of aliases) {
          const key = JSON.stringify([alias, slot.number]);
          const matches = this.byAliasAndNumber.get(key) ?? new Set<Slot>();
          matches.add(slot);
          this.byAliasAndNumber.set(key, matches);
        }
      }

      return { expansion, slots };
    });
    this.byId = new Map(this.ordered.map(checklist => [checklist.expansion.id, checklist]));
  }

  ownedSlots(game: CardGame, cards: readonly SetOwnershipCard[]) {
    const owned = new Set<Slot>();

    for (const card of cards) {
      if (card.pricingCardId != null) {
        if (card.pricingSource === PRICING_SOURCES.SCRYDEX_REAL) {
          for (const slot of this.byPricingId.get(card.pricingCardId) ?? []) {
            owned.add(slot);
          }
        }
      } else {
        const matches = this.byAliasAndNumber.get(
          JSON.stringify([normalize(card.setName), setCollectorNumber(game, card.cardNumber)]),
        );

        if (matches?.size === 1) {
          for (const slot of matches) {
            owned.add(slot);
          }
        }
      }
    }

    return owned;
  }

  memberships(key: string) {
    return Array.from(new Set((this.byPrintingKey.get(key) ?? []).map(slot => slot.setId))).flatMap(id => {
      const expansion = this.byId.get(id)?.expansion;

      return expansion == null ? [] : [{ id, name: expansion.name }];
    });
  }
}

export function matchesSet(expansion: SetExpansion, query: string) {
  return setAliases(expansion).some(alias => alias.includes(normalize(query)));
}

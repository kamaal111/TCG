import timers from 'node:timers/promises';

import { InternalServerError } from '@tcg/http/exceptions';
import {
  SCRYDEX_CATALOG_COLLECTION_MAP,
  SCRYDEX_FIRST_PAGE,
  type ScrydexCatalogCollection,
  type ScrydexRawCard,
} from '@tcg/scrydex';
import { z } from 'zod';

import { catalogExpansions, catalogPrintings } from './catalog-metadata.ts';
import type { CardCatalogRepository, CatalogPrintingRow } from './catalog-repository.ts';
import { catalogLogger, PRICING_EVENT_MAP } from './logging.ts';
import type { RealScrydexClient } from './scrydex/real-client.ts';
import type { CardGame } from './types.ts';
import { CARD_GAMES } from '../cards/types.ts';
import { ONE_HOUR_IN_MS, ONE_MINUTE_IN_MS, ONE_SECOND_IN_MS, ONE_WEEK_IN_HOURS } from '../constants/time.ts';
import type { GetRecordValues } from '../utils/type-utils.ts';

const REFRESH_AFTER_MS = ONE_WEEK_IN_HOURS * ONE_HOUR_IN_MS;
const BUILD_WAIT_SECONDS = 10;
const FAILED_BUILD_RETRY_MS = ONE_MINUTE_IN_MS;
const READINESS_POLL_MS = 250;
const MIN_REFRESH_PRINTING_RATIO = 0.95;

export const CATALOG_BUILD_STATUS_MAP = {
  READY: 'ready',
  BUSY: 'busy',
  FAILED: 'failed',
} as const;

type BuildResult = GetRecordValues<typeof CATALOG_BUILD_STATUS_MAP>;

export class CardCatalog {
  readonly repository: CardCatalogRepository;
  private readonly client: RealScrydexClient;
  private readonly builds = new Map<CardGame, Promise<BuildResult>>();
  private readonly failedAt = new Map<CardGame, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly stopping = new AbortController();

  constructor(repository: CardCatalogRepository, client: RealScrydexClient) {
    this.repository = repository;
    this.client = client;
  }

  start(): void {
    const refreshDue = () => {
      for (const game of CARD_GAMES) {
        void this.refresh(game, false);
      }
    };

    refreshDue();
    this.timer = setInterval(refreshDue, ONE_HOUR_IN_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.stopping.abort();
  }

  async idle(): Promise<void> {
    await Promise.all(this.builds.values());
  }

  async readyGeneration(game: CardGame, signal: AbortSignal): Promise<string | undefined> {
    const wait = AbortSignal.any([signal, AbortSignal.timeout(BUILD_WAIT_SECONDS * ONE_SECOND_IN_MS)]);
    const initial = await this.repository.generation(game, undefined);

    if (initial != null || wait.aborted) {
      return initial?.id;
    }

    if (Date.now() - (this.failedAt.get(game) ?? 0) < FAILED_BUILD_RETRY_MS) {
      return undefined;
    }

    const build = this.refresh(game, false);
    let outcome: BuildResult | undefined;
    void build.then(result => {
      outcome = result;
    });

    while (!wait.aborted && outcome !== CATALOG_BUILD_STATUS_MAP.FAILED) {
      const active = await this.repository.generation(game, undefined);

      if (active != null) {
        return active.id;
      }

      await timers.setTimeout(READINESS_POLL_MS, undefined, { signal: wait }).catch(() => undefined);
    }

    return undefined;
  }

  refresh(game: CardGame, force: boolean): Promise<BuildResult> {
    const existing = this.builds.get(game);

    if (existing != null) {
      return existing;
    }

    const build = this.build(game, force).finally(() => this.builds.delete(game));
    this.builds.set(game, build);

    return build;
  }

  private async build(game: CardGame, force: boolean): Promise<BuildResult> {
    const started = performance.now();

    try {
      const acquired = await this.repository.withBuildLock(game, async () => {
        const active = await this.repository.generation(game, undefined);

        if (!force && active != null && Date.now() - active.publishedAt.getTime() < REFRESH_AFTER_MS) {
          return;
        }

        const printings = await this.loadPrintings(game);

        if (
          printings.length === 0 ||
          (active != null && printings.length < active.printingCount * MIN_REFRESH_PRINTING_RATIO)
        ) {
          throw new InternalServerError(undefined, { diagnosticMessage: 'Scrydex catalog coverage check failed' });
        }

        await this.repository.publish(game, printings);
        this.failedAt.delete(game);
        catalogLogger().info(
          {
            event: PRICING_EVENT_MAP.CATALOG_COMPLETED,
            outcome: 'success',
            game,
            result_count: printings.length,
            duration_ms: Math.round(performance.now() - started),
          },
          'Published a complete card catalog.',
        );
      });

      return acquired ? CATALOG_BUILD_STATUS_MAP.READY : CATALOG_BUILD_STATUS_MAP.BUSY;
    } catch (err) {
      this.failedAt.set(game, Date.now());
      catalogLogger().error(
        {
          event: PRICING_EVENT_MAP.CATALOG_COMPLETED,
          outcome: 'failure',
          game,
          error_code: 'PRICING_CATALOG_BUILD_FAILED',
          duration_ms: Math.round(performance.now() - started),
          err,
        },
        'Card catalog build failed.',
      );

      return CATALOG_BUILD_STATUS_MAP.FAILED;
    }
  }

  private async loadPrintings(game: CardGame): Promise<CatalogPrintingRow[]> {
    const expansionRecords: ScrydexRawCard[] = [];

    for await (const page of this.pages(game, SCRYDEX_CATALOG_COLLECTION_MAP.EXPANSIONS)) {
      expansionRecords.push(...page);
    }

    const expansions = catalogExpansions(expansionRecords);
    const printings: CatalogPrintingRow[] = [];

    for await (const page of this.pages(game, SCRYDEX_CATALOG_COLLECTION_MAP.CARDS)) {
      for (const raw of page) {
        const cardPrintings = catalogPrintings(game, this.client.source, raw, expansions);

        if (cardPrintings.length === 0) {
          throw new InternalServerError(undefined, { diagnosticMessage: 'A Scrydex card had no usable printing' });
        }

        printings.push(...cardPrintings);
      }
    }

    return printings;
  }

  private async *pages(game: CardGame, collection: ScrydexCatalogCollection) {
    const ids = new Set<string>();
    let total: number | undefined;

    for (let page = SCRYDEX_FIRST_PAGE; ; page += 1) {
      if (this.stopping.signal.aborted) {
        throw new InternalServerError(undefined, { diagnosticMessage: 'Card catalog worker is stopping' });
      }

      const response = await this.client.catalogPage(game, collection, page);

      if (response.isErr()) {
        throw new InternalServerError(undefined, { diagnosticMessage: response.error.message });
      }

      const { cards, catalogTotal, hasMore, rejectedCount } = response.value;
      total ??= catalogTotal;

      if (cards.length === 0 || rejectedCount !== 0 || catalogTotal == null || catalogTotal !== total) {
        throw new InternalServerError(undefined, { diagnosticMessage: 'Incomplete Scrydex catalog pagination' });
      }

      for (const card of cards) {
        const id = z.string().trim().nonempty().safeParse(card.id).data;

        if (id == null || ids.has(id)) {
          throw new InternalServerError(undefined, { diagnosticMessage: 'Invalid or duplicate Scrydex catalog ID' });
        }

        ids.add(id);
      }

      if (hasMore ? ids.size >= catalogTotal : ids.size !== catalogTotal) {
        throw new InternalServerError(undefined, {
          diagnosticMessage: 'Scrydex catalog count did not match its pages',
        });
      }

      yield cards;

      if (!hasMore) {
        return;
      }
    }
  }
}

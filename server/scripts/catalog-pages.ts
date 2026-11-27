import { InternalServerError } from '@tcg/http/exceptions';
import { SCRYDEX_FIRST_PAGE, type ScrydexClient, type ScrydexRawCard } from '@tcg/scrydex';
import { z } from 'zod';

const CatalogRecordIdSchema = z.string().trim().nonempty();

export function catalogPages(budget: number) {
  let requests = 0;

  async function fetchScope(request: (page: number) => ReturnType<ScrydexClient['listCatalog']>) {
    const seen = new Set<string>();
    const collected: ScrydexRawCard[] = [];
    let total: number | undefined;

    for (let page = SCRYDEX_FIRST_PAGE; ; page += 1) {
      if (requests >= budget) {
        throw new InternalServerError(undefined, { diagnosticMessage: 'Catalog request budget exhausted' });
      }

      requests += 1;
      const result = await request(page);

      if (result.isErr()) {
        throw new InternalServerError(undefined, { diagnosticMessage: result.error.message });
      }

      const { catalogTotal, rejectedCount, cards: records, hasMore } = result.value;
      total ??= catalogTotal;

      if (catalogTotal == null || catalogTotal !== total || records.length === 0 || rejectedCount !== 0) {
        throw new InternalServerError(undefined, { diagnosticMessage: 'Incomplete scoped catalog response' });
      }

      for (const record of records) {
        const id = CatalogRecordIdSchema.parse(record.id);

        if (seen.has(id)) {
          throw new InternalServerError(undefined, { diagnosticMessage: 'Duplicate ID in scoped catalog response' });
        }

        collected.push(record);
        seen.add(id);
      }

      if (hasMore ? seen.size >= catalogTotal : seen.size !== catalogTotal) {
        throw new InternalServerError(undefined, {
          diagnosticMessage: 'Scoped catalog count does not match the response pages',
        });
      }

      if (!hasMore) {
        return collected;
      }
    }
  }

  return {
    fetchScope,
    get requests() {
      return requests;
    },
  };
}

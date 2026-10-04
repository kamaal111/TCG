# Scrydex provider client

External dependency versions are defined once in the default catalog in `pnpm-workspace.yaml`. The root, server, and package manifests use `catalog:` references; `@tcg/scrydex` uses `workspace:*` to link the local package. No dependency overrides are needed.

Private Node workspace package `@tcg/scrydex`. It exports TypeScript source for the repository's Node runtime; it is not published to npm.

```ts
import { ScrydexClient } from '@tcg/scrydex';

const client = new ScrydexClient({ apiKey: 'key', teamId: 'team' });
const result = await client.searchCards('pokemon', 'name:"Pikachu"');
```

`searchCards(game, query)` accepts a complete provider query unchanged and requests the first 20 cards with prices. Success contains validated `cards`, `providerResultCount`, and schema-level `rejectedCount`. Totals prefer `totalCount`, then `total_count`, then the original array length, including rejected entries.

`getCardById(game, id)` requests a safely encoded ID with prices. Success contains `{ card, statusCode }`, or `null` for HTTP 404. Both methods return `neverthrow` results. Errors distinguish missing credentials, network failures, timeout/abort, HTTP failures, and malformed responses. HTTP 429 and 5xx and transport failures are retryable. Error messages omit transport details and response bodies.

Options support `apiKey`, `teamId`, `baseURL` (default `https://api.scrydex.com`), `requestTimeoutMs` (default 8000), and injected `fetch` (default global fetch). Credentials must be supplied explicitly; the package does not read environment variables.

The exported Zod schemas validate nested structural data and retain unknown provider fields. Identity and price scalar fields remain unknown for consumer validation. Expansion names are trimmed; invalid expansion objects or names become undefined. These tolerant rules preserve the existing client contract and are covered explicitly for future refactoring.

The server owns user-query translation, language filtering, normalized card identity, base-variant selection, and pricing normalization. Schema-valid cards can still be unusable for pricing; the server adapter adds those rejections to the package count.

From the repository root:

- `just test-packages` runs isolated package tests with per-file 100% statements, branches, functions, and lines coverage thresholds across all production source.
- `just typecheck-packages` verifies package source and tests.
- `just ready-server` includes package checks, server integration tests, and the production image smoke test.

Tests inject only the fetch boundary and use synthetic provider responses. No Scrydex credentials, live provider calls, database, or server startup are required for package checks. Coverage reports are written to this package's ignored `coverage` directory.

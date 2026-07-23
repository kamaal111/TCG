# Card Pricing Vertical Slice

## Context

Users can currently track the cards they own (`server/src/cards` + Swift `TCGCards`), but there is **no pricing anywhere** — no price on cards, no card search, no third-party integration. We want two capabilities:

1. **Owned-card prices** — every card in a user's collection shows its current market price.
2. **Card search + price** — users can search for any card and see its price.

Prices come from **TCGGO** (RapidAPI product `cardmarket-api-tcg`, host `cardmarket-api-tcg.p.rapidapi.com`), documented in `.agents/prompts/tcggo.md`. Pricing is embedded in card search / card-by-id responses; there is no price-only endpoint.

Two hard constraints from the user:

- **No API key yet.** We build **two interchangeable TCGGO clients** selected via `.env`: a **static client** returning accurate canned responses (so the whole feature works end-to-end today) and a **real client** that calls RapidAPI. Flipping one env var to the real client + supplying the key must make everything work unchanged.
- **Per-card, per-day dedup.** If 20 users request the same card on the same day, TCGGO is called **once** for that card that day. Caching is **global (not per-user)**, keyed by TCGGO card id + calendar day (UTC).

Confirmed product decisions: app gets a **TabView** (Collection + Search); owned prices are fetched in **one batch call** and shown **inline in each `CardRow`**; the **headline price is Cardmarket `lowest_near_mint` in EUR**, with 7d/30d averages + a trend arrow as secondary.

This is a new vertical slice: **`card-pricing`** on the server, mirroring the existing `cards` slice layout exactly.

---

## TCGGO API reference (confirmed from research)

- Base URL `https://cardmarket-api-tcg.p.rapidapi.com`, host header `cardmarket-api-tcg.p.rapidapi.com`.
- **Search**: `GET /{gamePath}/cards?search={q}&sort={sort}` → array of card objects.
- **Card by id**: `GET /{gamePath}/cards/{id}` → single card object (use for refresh).
- Auth headers: `x-rapidapi-key: <key>`, `x-rapidapi-host: <host>`.
- `gamePath`: pokemon → `pokemon` (confirmed). one_piece → **`onepiece` (best-guess default, env-overridable — see below)**.
- Response shape per `.agents/prompts/tcggo.md` §5–6/11: `{ id, name, card_number, rarity, image, prices: { cardmarket{currency,lowest_near_mint,7d_average,30d_average,graded...}, tcg_player|tcgplayer{currency,market_price,mid_price}, ebay{...} } }`. **All price fields optional**; Pokémon uses `tcg_player`, One Piece uses `tcgplayer` — normalize both. Always read the returned `currency`.

> ⚠️ **One Piece path segment — could not be verified without the key** (attempted: official docs → 403; RapidAPI playground → JS-gated, no data; unauthenticated probing → `401` for _every_ path incl. a garbage path, because RapidAPI rejects on missing key before routing). Default to `onepiece` but make it **env-overridable** (`TCGGO_ONE_PIECE_PATH`) so a wrong guess is a one-line `.env` fix, not a code change. Also confirm `sort` values + header casing against the playground when the key arrives. All of this is isolated in the real client only; the static client is unaffected.

---

## Server: `server/src/card-pricing/` slice

Mirror the `cards` slice file layout (route.ts, routes/_, handlers/_, schemas/_, repository.ts, constants.ts, tests/_). Mount in `server/src/app-api/index.ts` via `.route(PRICING_ROUTE_NAME, pricingRoute)` (`PRICING_ROUTE_NAME='/pricing'`, tag `'Pricing'`), guarded by `allowedModes(SERVER_MODES.SERVER)` like `cards`.

### 1. Env (`server/src/env.ts` + `vitest.config.ts`)

Add to `EnvSchema`:

```ts
TCGGO_CLIENT: z.enum(['static', 'real']).default('static'),
TCGGO_API_KEY: z.string().optional(),
TCGGO_API_HOST: z.string().default('cardmarket-api-tcg.p.rapidapi.com'),
TCGGO_BASE_URL: z.url().default('https://cardmarket-api-tcg.p.rapidapi.com'),
TCGGO_ONE_PIECE_PATH: z.string().default('onepiece'), // best-guess; unverifiable without key — flip in .env if wrong
```

`gamePath(game)` in the real client maps pokemon → `'pokemon'`, one_piece → `env.TCGGO_ONE_PIECE_PATH`.
Add `.superRefine` (or post-parse check): if `TCGGO_CLIENT === 'real'` then `TCGGO_API_KEY` is required (throw at boot otherwise). Default is `static`, so local dev + tests need no key. Add `TCGGO_CLIENT: 'static'` to `vitest.config.ts` `TEST_ENV`.

### 2. TCGGO client abstraction — `server/src/card-pricing/tcggo/`

- `types.ts` — raw `TCGGORawCard` + internal `NormalizedPricing` (`{ cardmarket?: {currency, lowestNearMint?, average7d?, average30d?}, tcgplayer?: {currency, marketPrice?, midPrice?}, image?, rarity? }`).
- `client.ts` — interface:
  ```ts
  export interface TCGGOClient {
    searchCards(game: CardGame, query: string): Promise<TCGGORawCard[]>;
    getCardById(game: CardGame, id: string): Promise<TCGGORawCard | null>;
  }
  ```
- `real-client.ts` — `RealTCGGOClient` using global `fetch` (no new dependency). Builds URL from `TCGGO_BASE_URL` + `gamePath(game)` + `/cards`, sets the two rapidapi headers. `gamePath` map is the single place the one_piece uncertainty lives.
- `static-client.ts` — `StaticTCGGOClient`: canned responses matching the documented JSON for known cards (Giratina VSTAR `GG69`, Charizard ex `199`, Marshall.D.Teach `OP09-093`) **plus a deterministic synthetic response** for any other query (stable hash-derived price) so search/owned always return something usable. Must exercise partial-response and `tcg_player`/`tcgplayer` variance so the normalizer is proven.
- `normalize.ts` — `normalizeTCGGOCard(raw): { id, name, cardNumber, pricing: NormalizedPricing }`; treats every field optional, reads `currency` from the payload, unifies `tcg_player`/`tcgplayer`.
- `factory.ts` — `createTCGGOClient(env): TCGGOClient` → static or real.

Wire into DI: add `tcggo: TCGGOClient` to `InjectedContext` (`server/src/context.ts`), set it in `injectRequestContext`, build it in `createApp` (`server/src/app.ts`) via the factory, and add `tcggo` to the `App` constructor `overrides` `Pick` + the `integrationTest` fixture (`server/src/tests/fixtures.ts`) so tests inject a controllable static client and can assert call counts. Follows the existing `db`/`auth` injection precedent.

### 3. Database — `server/src/db/schema/card-pricing.ts`

Global cache tables (NOT user-scoped — that is what enables cross-user dedup). Reuse `cardGameEnum`. `pricedOn` is a `date` column = current UTC calendar day; day rollover naturally expires the cache (no TTL job for MVP).

`card_price` (per-card-per-day normalized cache — the dedup guarantee):

```
id text pk
game            card_game not null
tcggoCardId     text not null            -- TCGGO card id
cardNumber      text not null            -- normalized, for lookup/debug
name            text not null
pricedOn        date not null
prices          jsonb not null           -- full NormalizedPricing (+ raw graded/ebay kept for later)
raw             jsonb                     -- optional raw response, debugging
source          text not null            -- 'static' | 'real'
fetchedAt       timestamp not null default now
uniqueIndex (game, tcggoCardId, pricedOn)   -- ← "one request per card per day"
index       (game, cardNumber, pricedOn)
```

`card_price_search` (per-query-per-day search cache — dedups repeated identical searches):

```
id text pk
game          card_game not null
queryKey      text not null              -- normalized, lowercased query
pricedOn      date not null
tcggoCardIds  jsonb not null             -- ordered TCGGO ids (join to card_price)
fetchedAt     timestamp not null default now
uniqueIndex (game, queryKey, pricedOn)
```

Add nullable column to existing `card` table (`server/src/db/schema/cards.ts`): `tcggoCardId text` — persists a matched TCGGO id per owned card so future days refresh **by id** (no re-search), per the doc's "save the TCGGO card ID". Wire the new schema file into `server/src/db/schema/index.ts` (`export *`; no relations needed but keep the merge call consistent). Run `just make-migrations`, review the generated SQL, `just migrate`.

### 4. Query normalization + matching — `server/src/card-pricing/utils/query.ts`

- `normalizeCardNumber(raw)` — uppercase, trim, collapse whitespace, keep hyphens (`OP09-093`).
- `normalizeName(raw)` — trim, collapse whitespace.
- `buildSearchQuery(name, cardNumber)` → `"{name} {cardNumber}"`.
- `queryKey(game, query)` → `"{game}|{lowercased normalized query}"`.
- `matchCard(cards, name, cardNumber)` — pick best result: exact normalized `card_number` match first, then name match; return `{ card, confidence }` or `null`. Confidence + presence of price drive the response status.
- `todayUTC()` → `YYYY-MM-DD`.

### 5. Service + repository (keep DB access in the repository, per repository-layer guidance)

`repository.ts` (`CardPricingRepository`, static methods, `c.get('db')`): `getCachedCardPrice`, `upsertCardPrice` (`onConflictDoUpdate` on the unique index), `getCachedSearch`, `upsertSearch`, `setOwnedCardTcggoId(c, cardId, userId, id)`. Reuse `CardRepository.list(c)` for the owned-card set.

`service.ts` (orchestration; uses repository + `c.get('tcggo')`; logs `cache_status: 'hit'|'miss'|'set'` — the field already exists in `server/src/logging/index.ts`):

- `searchAndPrice(c, game, name/query)`: compute `queryKey`; check `card_price_search(game,queryKey,today)` → hit reads cached `card_price` rows and returns; miss calls `tcggo.searchCards` **(1 request)**, `matchCard`, upserts `card_price` rows + the search row, returns matches. No results → status `no_results`.
- `priceOwnedCard(c, card)`: if `card.tcggoCardId` → check `card_price(game,id,today)`; hit returns, miss `tcggo.getCardById` **(1 request)** + upsert. If no `tcggoCardId` → run `searchAndPrice`, persist the matched id onto the card row. Per-card status: `priced` | `no_match` | `no_price`.

### 6. Endpoints (`/app-api/pricing`, auth via `requireLoggedInSessionMiddleware` + bearerAuth)

- `GET /pricing/search?game={game}&query={query}` → `{ query, normalized_query, game, status: 'ok'|'no_results', matches: PricedCard[] }`. 400 on missing/short query (via zod param schema + router `defaultHook`).
- `GET /pricing/owned?game={game}` (game optional) → `{ prices: OwnedCardPrice[] }`, `OwnedCardPrice = { card_id, status: 'priced'|'no_match'|'no_price', price?: PricedCard }`.

Response schema `PricedCard` (`schemas/responses.ts`, zod-openapi):

```
tcggo_card_id, game, name, card_number, rarity?, image_url?,
headline?: { amount, currency, metric: 'lowest_near_mint' },   // Cardmarket lowest NM EUR; absent → status no_price
cardmarket?: { currency, lowest_near_mint?, average_7d?, average_30d?, trend?: 'up'|'down'|'flat' },
tcgplayer?:  { currency, market_price?, mid_price? },
priced_on (date), fetched_at (datetime)
```

`trend` = compare `average_7d` vs `average_30d`. Graded/eBay are stored in `prices` jsonb but **not** exposed in the API surface for MVP. Serializer in `utils/pricing.ts` re-validates against the schema before returning (mirrors `cards/utils/cards.ts`).

### 7. Regenerate contract

New routes change the OpenAPI spec → run `just download-spec` (writes `app/Modules/TCGClient/Sources/TCGClient/openapi.yaml`) and commit it, or `just ready`'s `check-spec` fails.

---

## Swift app

### 1. TCGClient (`app/Modules/TCGClient/Sources/TCGClient/`)

- Models: `Models/CardPrice.swift` (`PricedCard`, `CardMarketPrice`, `TCGPlayerPrice`, `PriceHeadline`, `PriceTrend`) and `Models/OwnedCardPrice.swift` (`OwnedCardPrice`, `OwnedCardPriceStatus`) — Codable/Sendable, snake_case `CodingKeys`.
- `TCGPricingClient.swift` — protocol + `…Impl` mirroring `TCGCardsClient`: `search(game:query:) -> Result<CardSearchResult, SearchPricingErrors>`, `ownedPrices(game:) -> Result<[OwnedCardPrice], OwnedPricesErrors>`; map generated `Operations.*` / `Components.Schemas.*` in private `make…` helpers (generated types never leak).
- `Errors/Pricing/PricingErrors.swift` — `SearchPricingErrors`, `OwnedPricesErrors` (`.unauthorized`, `.badRequest(validations:)`, `.unknown(status:payload:cause:)`), reusing `TCGClientValidationErrorParser`.
- Add `pricing: TCGPricingClient` to the `TCGClient` facade + `default()` + `preview(...)` (`TCGClient.swift`).
- `Preview/PreviewTCGPricingClient.swift` — `samplePricedCards` + `PreviewTCGPricingOutcome` (`.success/.empty/.noResults/.unauthorized/.serverUnavailable`).
- Follow the `tcg-client-endpoint` skill for the endpoint + its transport-boundary tests.

### 2. Owned prices in the Collection (extend `TCGCards`)

- In `TCGCards.swift`: add `loadOwnedPrices()` populating `private(set) var prices: [String: OwnedCardPrice]` (keyed by card id) via `TCGClient.pricing.ownedPrices`, plus mapping to a feature-level `LocalizedError`. Trigger from `TCGCardsListScreen`'s `.task` after cards load.
- `CardRow.swift`: add a trailing price view — headline (`€146.69`) when `status == priced`, a subtle placeholder/ProgressView while loading, and `—`/"No price" for `no_match`/`no_price`. Keep the existing quantity.

### 3. Search feature — new `TCGSearch` target in `TCGFeatures`

Mirror the `TCGCards` module structure (new product `TCGSearch` in `TCGFeatures/Package.swift`; `TCGApp/Package.swift` depends on it):

- `TCGSearch.swift` (`@MainActor @Observable`, wraps `TCGClient`, `search(game:query:)`, holds `results`, `isSearching`, `status`), `TCGSearchEnvironment.swift` (`.tcgSearch(_:)`), `ModuleConfig.swift`.
- `Views/Screens/TCGSearchScreen.swift` — `.searchable` field + game `Picker`, results list, `ContentUnavailableView` for empty/no-results with **guidance text** ("No match — try adding the set number, e.g. `Charizard 199`"), toast for errors.
- `Views/PricedCardRow.swift` — name, `set • number`, headline price + trend arrow, secondary 7d/30d.
- `Views/TCGSearchScreenModel.swift` — `@MainActor @Observable`; debounces query, maps `.failure` → toast (mirror `TCGCardsListScreenModel`).
- `Models/TCGSearchOperationError.swift` (`LocalizedError`).

### 4. App shell — `TCGApp/Sources/TCGApp/TCGApp.swift`

Replace the single `NavigationStack { TCGCardsListScreen() }` with a `TabView`: tab 1 `NavigationStack { TCGCardsListScreen() }` (`Label("Collection", systemImage: "square.stack")`), tab 2 `NavigationStack { TCGSearchScreen() }` (`Label("Search", systemImage: "magnifyingglass")`). Own `TCGSearch.default()` and inject `.tcgSearch(search)` alongside the existing `.tcgCards`/`.tcgAuth`.

---

## Tests (must accompany the change)

**Invariant — tests make ZERO external network requests (server and app).** Only the **real** client ever calls TCGGO, and it is never constructed or exercised in any test:

- **Server**: `vitest.config.ts` `TEST_ENV` pins `TCGGO_CLIENT='static'`, and the `integrationTest` fixture injects a `StaticTCGGOClient` (pure in-memory, no `fetch`). The dedup test uses a call-counting wrapper around the static client — the counter is in-process, not a network call. No test imports/instantiates `RealTCGGOClient`. (Existing tests already avoid the network via in-process `app.request(...)`; this keeps that property.)
- **App**: boundary tests use a recording in-memory `ClientTransport` (already the pattern in `TCGCardsClientTests`); feature/snapshot tests use `TCGClient.preview(...)` / `PreviewTCGPricingClient`. No `URLSessionTransport`, no live server.

- **Server integration** (`card-pricing/tests/*.integration.test.ts`, `integrationTest` fixture, real Postgres): `search` (match, no-results, 400 on bad query), `owned` (priced / no_match / mixed). **Dedup test**: inject a static client that counts calls; issue the same owned/search request twice (and as two users) → assert TCGGO called **once** and the second read is `cache_status: 'hit'`.
- **Server unit**: `tcggo-static-client.test.ts` (canned + synthetic + partial/`tcgplayer` variance) and `query.test.ts` (normalization + `matchCard`). New preview/static outcomes need their own unit tests (per project guidance).
- **Swift transport-boundary** (`TCGClientTests/TCGPricingClientTests.swift`): recording `ClientTransport`, assert method/path/operationID, decode responses; `PreviewTCGPricingClientTests.swift` covers every preview outcome.
- **Swift snapshots** (light **and** dark, macOS + iOS, via `assertScreenSnapshot`): new `TCGSearchTests/TCGSearchScreenSnapshotTests.swift` (results / empty / no-results-guidance), and update `TCGCardsListScreenSnapshotTests` to include a priced-collection state (record new baselines). Add the new suite to the `just test-snapshots-macos/ios` recipes.

## Verification (end to end)

1. `just make-migrations` → review SQL → `just migrate`.
2. `just download-spec` → commit updated `openapi.yaml`.
3. Server tests (`pnpm run test` in `server/`), incl. the dedup test — proves the static client drives the whole flow with **no key**.
4. Swift build + boundary + snapshot tests (record baselines).
5. `just ready` must pass (do not claim completion until it does).
6. **When the real key arrives**: set `TCGGO_CLIENT=real` + `TCGGO_API_KEY`; confirm the One Piece path against the playground and, if it isn't `onepiece`, set `TCGGO_ONE_PIECE_PATH` (no code change); confirm `sort` values + header casing (isolated in `real-client.ts`). Nothing else changes.

## Out of scope (MVP)

Graded/eBay pricing in the API surface (stored, not exposed), price history over time, currency conversion, and a cache-cleanup job (day-based `pricedOn` self-expires).

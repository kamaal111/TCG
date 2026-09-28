# TCG Card Collection Management — Fullstack Implementation Plan

> Historical implementation plan: the context, file paths, and proposed behavior below describe the project when this work was planned. For the current implementation and workflows, see [the project README](../../README.md) and [architecture guide](../../docs/architecture.md).

## Context

The app (One Piece TCG + Pokemon TCG collection manager) has completed auth. This feature adds the core value: adding, editing, and deleting owned card entries, fullstack — Drizzle schema + migration, Hono endpoints, OAS regeneration, Swift client wrapper, and a new `TCGCards` vertical feature slice as the post-login root screen. Shared UI (form field wrapper, submit/loading button) is extracted from `TCGAuth` into `TCGDesignSystem` so auth and cards UIs cannot drift.

**User-confirmed product decisions:**

- Entity = "owned card entry": game (`one_piece` | `pokemon`), card name, set name, card number, optional notes. Free-form entry, no external catalog.
- **Quantity is tracked per condition** — one entry holds multiple (condition, quantity) pairs (e.g. 2 near-mint + 1 played).
- Post-login root screen = the collection list; add via sheet, edit via tap, delete via swipe.

**Hard constraints:**

- Existing auth snapshot baselines in `app/Modules/TCGFeatures/Tests/TCGAuthTests/__Snapshots__/` must remain **byte-identical** — never re-record them.
- No `@unchecked Sendable` in shipped code (use `OSAllocatedUnfairLock`).
- Snapshot flows driven via configurable preview clients, not `RequestTransport` stubs.
- Every new preview-client outcome needs unit tests for the preview client itself.
- All snapshot tests light + dark, macOS + iOS. No branching in test bodies.
- Vertical slice architecture on both sides — mirror `server/src/auth/` and `TCGFeatures/Sources/TCGAuth` exactly.
- All server db reads/writes for this feature go through a **repository layer** (`server/src/cards/repository.ts`) — handlers never touch Drizzle directly. Repository functions never accept a `userId` parameter; they derive it internally from `getSessionWhereSessionIsRequired(c)` so querying another user's cards is structurally impossible.
- Designed for scale: every query path is backed by an index (see index strategy in Phase 1); no N+1 loading.
- Every cards endpoint requires a session via the existing `requireLoggedInSessionMiddleware`.
- Finish with `just ready`; don't claim completion until it passes.

---

## Phase 1 — Database schema + migration

### New file `server/src/db/schema/cards.ts`

Repo conventions (from `server/src/db/schema/better-auth.ts`): `pgTable`, camelCase TS / snake_case columns, `text` string PKs, `timestamp('created_at').defaultNow().notNull()`, `updated_at` with `.$onUpdate(() => new Date())`, FKs with `onDelete: 'cascade'`, indexes via third-arg array. No id helper exists in the repo (better-auth generates its own ids) → use `.$defaultFn(() => crypto.randomUUID())`.

```ts
import crypto from 'node:crypto';

import { defineRelationsPart } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { user } from './better-auth.ts';

export const CARD_GAMES = ['one_piece', 'pokemon'] as const;
export const CARD_CONDITIONS = ['mint', 'near_mint', 'excellent', 'good', 'played', 'damaged'] as const;

export const cardGameEnum = pgEnum('card_game', CARD_GAMES);
export const cardConditionEnum = pgEnum('card_condition', CARD_CONDITIONS);

export const card = pgTable(
  'card',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    game: cardGameEnum('game').notNull(),
    name: text('name').notNull(),
    setName: text('set_name').notNull(),
    cardNumber: text('card_number').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [index('card_userId_createdAt_idx').on(table.userId, table.createdAt)],
);

export const cardConditionQuantity = pgTable(
  'card_condition_quantity',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    cardId: text('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    condition: cardConditionEnum('condition').notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [uniqueIndex('card_condition_quantity_cardId_condition_idx').on(table.cardId, table.condition)],
);

export const cardsRelations = defineRelationsPart({ user, card, cardConditionQuantity }, r => ({
  card: {
    user: r.one.user({ from: r.card.userId, to: r.user.id }),
    quantities: r.many.cardConditionQuantity({ from: r.card.id, to: r.cardConditionQuantity.cardId }),
  },
  cardConditionQuantity: {
    card: r.one.card({ from: r.cardConditionQuantity.cardId, to: r.card.id }),
  },
}));
```

### Index strategy (scale: many users × many cards — every query must be an index scan)

| Query                                                         | Served by                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List a user's cards ordered by newest first                   | `card_userId_createdAt_idx (user_id, created_at)` — composite covers both the filter and the sort, so listing is a single ordered index range scan regardless of total table size.                                                                                                                      |
| Ownership-checked fetch (`id` + `user_id`) for update/delete  | Primary key on `card.id` (unique, instant), then compare `user_id` on the single fetched row.                                                                                                                                                                                                           |
| Quantities for a card                                         | `card_condition_quantity_cardId_condition_idx (card_id, condition)` — the unique composite's **leading column is `card_id`**, so it serves plain `card_id` lookups too; a separate `card_id` index would be redundant write overhead, so there is none. It also enforces one row per (card, condition). |
| Cascade deletes (`user` → `card` → `card_condition_quantity`) | Same two indexes above cover the FK lookups (Postgres uses them when cascading).                                                                                                                                                                                                                        |

Quantities for a list page are loaded via RQB v2 `with: { quantities: true }` (batched by Drizzle — no N+1). The list endpoint returns cards ordered `created_at` desc. MVP is unpaginated; the composite index already supports adding keyset/cursor pagination later without a schema change.

All APIs used are the current drizzle-orm 1.0.0-rc.4 forms already in the repo (RQB v2 object-style `where`, `defineRelationsPart`, array-form third-arg indexes, `.$onUpdate`/`.$defaultFn`) — nothing deprecated.

**Relations wiring** (verified: `defineRelationsPart` returns an object keyed by table name; parts combine by spread; the cards part emits no `user` key so it cannot clobber `user.sessions`/`user.accounts` from `authRelations` at `server/src/db/schema/better-auth.ts:86`):

- `server/src/db/schema/index.ts`:

  ```ts
  export * from './better-auth.ts';
  export * from './cards.ts';

  import { authRelations } from './better-auth.ts';
  import { cardsRelations } from './cards.ts';
  export const appRelations = { ...authRelations, ...cardsRelations };
  ```

- `server/src/db/index.ts:4,8` — switch `authRelations` → `appRelations` (import from `./schema/index.ts`, `drizzle<typeof appRelations>(env.DATABASE_URL, { relations: appRelations, logger: env.DEBUG })`).
- `server/src/tests/utils.ts:10,34` — same swap so `db.query.card` / `db.query.cardConditionQuantity` work in tests.

**Migration:** `just make-migrations` → `just start-services` → `just migrate`. Commit the new folder under `server/drizzle/`.

---

## Phase 2 — Server slice `server/src/cards/`

Mirror `server/src/auth/` file-for-file. Mount in `server/src/app-api/index.ts` with `.route(CARDS_ROUTE_NAME, cardsRoute)`.

### Endpoints (all protected)

**Every cards route requires a session** via the existing `requireLoggedInSessionMiddleware` (`server/src/auth/middleware.ts`): attach `middleware: [requireLoggedInSessionMiddleware] as const` + `security: [{ bearerAuth: [] }]` on every `createRoute` definition (copy the exact shape from `server/src/auth/routes/session.ts`). Handlers read the user via `getSessionWhereSessionIsRequired(c).user.id` (`server/src/auth/utils/session.ts`).

**Important:** an unauthenticated request yields **404 `SESSION_NOT_FOUND`** (that is how `requireLoggedInSessionMiddleware` behaves today — it throws `SessionNotFound extends NotFound`), NOT 401. Document 404 with `ErrorResponseSchema` on every route. The Swift client must branch on the error `code` to disambiguate `SESSION_NOT_FOUND` vs `CARD_NOT_FOUND`.

| Op     | Method + spec path                                        | Success                                                                                      | Errors                                 |
| ------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| create | `POST /app-api/cards/` (route `path: '/'`)                | 201 `Card`                                                                                   | 400 `ValidationErrorResponse`, 404     |
| list   | `GET /app-api/cards/` (route `path: '/'`)                 | 200 `CardsListResponse`                                                                      | 404                                    |
| update | `PUT /app-api/cards/{cardId}` (route `path: '/{cardId}'`) | 200 `Card`                                                                                   | 400, 404 (session or `CARD_NOT_FOUND`) |
| delete | `DELETE /app-api/cards/{cardId}`                          | 200 `DeleteCardResponse` (`z.object({})` — repo `STATUS_CODES` has no 204; mirrors sign-out) | 404                                    |

**Update semantics: full replace.** In one `db.transaction`: update the `card` scalar fields, `delete` all `card_condition_quantity` rows for the card, bulk-insert the new quantities.

**Ownership:** every fetch filters `{ id: cardId, userId }`; miss → throw `CardNotFound` (404, no existence leak — other users' cards are indistinguishable from nonexistent).

### Repository layer (`server/src/cards/repository.ts`)

All reads and writes of `card` / `card_condition_quantity` go through this module — handlers never call `db.*` directly. **The repository is session-scoped by construction: no function accepts a `userId` parameter.** Every function takes the request context `c: HonoContext` (the same untyped-generics alias `getSessionWhereSessionIsRequired` accepts — see `server/src/auth/utils/session.ts:4`) and internally derives `const db = c.get('db')` and `const userId = getSessionWhereSessionIsRequired(c).user.id`. This makes it structurally impossible to query or mutate another user's cards — there is no code path where a caller supplies a foreign user id, and calling the repository without a session throws `SessionNotFound`.

```ts
export type CardWithQuantities = /* card row + { quantities: cardConditionQuantity rows } */;

export function listCardsForSessionUser(c: HonoContext): Promise<CardWithQuantities[]>
  // db.query.card.findMany({ where: { userId }, with: { quantities: true }, orderBy: { createdAt: 'desc' } })
export function getCardForSessionUser(c: HonoContext, cardId: string): Promise<CardWithQuantities | undefined>
  // db.query.card.findFirst({ where: { id: cardId, userId }, with: { quantities: true } })
export function createCardForSessionUser(c: HonoContext, values: UpsertCard): Promise<CardWithQuantities>
  // db.transaction: insert card with the session userId (.returning()), bulk-insert quantities (.returning())
export function updateCardReplacingQuantitiesForSessionUser(c: HonoContext, cardId: string, values: UpsertCard): Promise<CardWithQuantities | undefined>
  // db.transaction: update(card).set(...).where(and(eq(card.id, cardId), eq(card.userId, userId))).returning();
  // undefined when no row matched (handler throws CardNotFound); else delete old quantities + bulk-insert new
export function deleteCardForSessionUser(c: HonoContext, cardId: string): Promise<boolean>
  // delete(card).where(and(eq(card.id, cardId), eq(card.userId, userId))).returning({ id })
  // false when nothing deleted; quantities cascade
```

Note the mutation paths fold the ownership check into the `WHERE` of the mutation itself (single statement, no read-then-write race); RQB v2 `with: { quantities: true }` batch-loads quantities without N+1. The repository is exercised through the endpoint integration tests (real Postgres) — the two-users isolation tests prove the session scoping — no mocked-db unit tests.

### Schemas

`server/src/cards/schemas/payloads.ts` — zod v4 via `@hono/zod-openapi`, snake_case JSON, per-field `.openapi({description, example})`, object-level `.openapi('Name', {...})` exactly like `server/src/auth/schemas/payloads.ts`:

```ts
const CardConditionQuantityInputSchema = z.object({
  condition: z.enum(CARD_CONDITIONS),          // + .openapi
  quantity: z.number().int().min(1).max(999),  // + .openapi
});

export const UpsertCardSchema = z.object({
  game: z.enum(CARD_GAMES),
  name: z.string().min(1).max(200),
  set_name: z.string().min(1).max(200),
  card_number: z.string().min(1).max(50),
  notes: z.string().max(2000).optional(),
  quantities: z.array(CardConditionQuantityInputSchema).min(1).max(CARD_CONDITIONS.length)
    .refine(qs => new Set(qs.map(q => q.condition)).size === qs.length, { message: 'Conditions must be unique' }),
}).openapi('UpsertCard', {...});
export type UpsertCard = z.infer<typeof UpsertCardSchema>;
```

`server/src/cards/schemas/params.ts` — `CardIdParamsSchema = z.object({ cardId: z.string().nonempty().openapi({ param: { name: 'cardId', in: 'path' }, example: '<uuid>' }) })`.

`server/src/cards/schemas/responses.ts` — datetimes via `ApiCommonDatetimeShape` (`src/schemas/common.ts`), serialized with `.toISOString()`; `notes` is `z.string().nullable()` (null when absent → clean Swift Optional); quantities sorted in `CARD_CONDITIONS` order for determinism:

```ts
export const CardConditionQuantitySchema = z.object({
  condition: z.enum(CARD_CONDITIONS), quantity: z.number().int(),
}).openapi('CardConditionQuantity', {...});

export const CardSchema = z.object({
  id: z.string().nonempty(), game: z.enum(CARD_GAMES),
  name: z.string(), set_name: z.string(), card_number: z.string(),
  notes: z.string().nullable(),
  quantities: z.array(CardConditionQuantitySchema),
  created_at: ApiCommonDatetimeShape, updated_at: ApiCommonDatetimeShape,
}).openapi('Card', {...});

export const CardsListResponseSchema = z.object({ cards: z.array(CardSchema) }).openapi('CardsListResponse', {...});
export const DeleteCardResponseSchema = z.object({}).openapi('DeleteCardResponse', {...});
```

### File-by-file

- `constants.ts` — `CARDS_ROUTE_NAME = '/cards'`, `CARDS_OPENAPI_TAG = 'Cards'`, per-endpoint path consts.
- `exceptions.ts` — `export class CardNotFound extends NotFound {}` thrown with `{ message: 'Card not found', code: 'CARD_NOT_FOUND' }` (match the ctor options shape in `server/src/exceptions/index.ts`). Validation 400 comes free from `openAPIRouterFactory`'s `defaultHook` (`INVALID_PAYLOAD`).
- `routes/create-card.ts` / `list-cards.ts` / `update-card.ts` / `delete-card.ts` — `createRoute` defs mirroring `auth/routes/sign-up.ts` (+ protected shape from `auth/routes/session.ts`); reference `ValidationErrorResponseSchema` for 400 and `ErrorResponseSchema` for 404 (`src/schemas/errors.ts`); statuses from `STATUS_CODES` (`src/constants/http.ts`).
- `repository.ts` — the only module touching the db for this slice; session-scoped, takes `c`, never a `userId` (see above).
- `handlers/*.ts` — one per endpoint; each exports `*_ROUTE_PATH = \`${APP_API_ROUTE_NAME}${CARDS_ROUTE_NAME}${route.path}\` as const`(pattern:`auth/handlers/session.ts`); typed `HonoContext<typeof PATH, { out: { json: UpsertCard; param: { cardId: string } } }>`returning`TypedResponse<Body, Status>`; input via `c.req.valid('json')`/`c.req.valid('param')`; calls the repository with `c`, throws `CardNotFound`on`undefined`/`false`; output serialized via `serializeCard`and parsed through the response schema before`c.json`; structured log per handler (`event: 'cards.create' | 'cards.list' | 'cards.update' | 'cards.delete'`, mirror the field set asserted in `auth/tests/session.integration.test.ts`).
- `utils/cards.ts` — `serializeCard(cardWithQuantities): Card` only (row → snake_case response shape, quantities sorted in `CARD_CONDITIONS` order, dates `.toISOString()`). No db access here.
- `route.ts` — `openAPIRouterFactory()` + `allowedModes(SERVER_MODES.SERVER)` + four `.openapi(route, handler)` registrations.
- `server/src/app-api/index.ts` — add the mount.

### Integration tests (`server/src/cards/tests/*.integration.test.ts`)

Use the `integrationTest` fixture (`server/src/tests/fixtures.ts` — per-test Postgres db + `new App({db})`), `createTestUser(app, db)` for auth (`Cookie: better-auth.session_token=${sessionToken}`), helpers `expectErrorResponse` / `expectValidationIssueForField(s)` (`server/src/tests/auth.ts`), log assertions via `withRequestId` / `getLogsForRequestId`.

`create-card.integration.test.ts`

1. 404 without a session.
2. 400 per-field validation: missing/empty `name`, `set_name`, `card_number`; invalid `game`; empty `quantities`; `quantity: 0`; non-integer quantity; invalid `condition`; duplicate conditions; over-long `name`.
3. 201 success: body parses with `CardSchema`, `notes: null` when omitted; DB assertions — `card` row has creator's `userId`, `card_condition_quantity` rows match payload; structured log asserted.
4. 201 with notes + multiple conditions round-trips.

`list-cards.integration.test.ts`

1. 404 without session. 2. 200 empty list for fresh user. 3. 200 returns created cards with quantities, ordered newest-first (parse with `CardsListResponseSchema`, assert order). 4. Ownership isolation: user B's list excludes user A's cards. 5. Log assertion.

`update-card.integration.test.ts`

1. 404 without session. 2. 404 unknown `cardId` (assert `code: 'CARD_NOT_FOUND'`). 3. 404 for another user's card, DB row unchanged. 4. 400 validation spot-checks. 5. 200 full-replace: `[near_mint:2, played:1]` → `[mint:1]` leaves exactly one quantity row in DB, scalars updated, `updated_at` changed; log asserted.

`delete-card.integration.test.ts`

1. 404 without session. 2. 404 unknown id / other user's card (row still present). 3. 200 success: card row gone, quantity rows cascade-deleted, other cards untouched; log asserted.

**Verify:** `just test-server`, `just typecheck`, `just lint`, `just format-check-js`.

---

## Phase 3 — OAS regeneration

`just download-spec` → commit updated `app/Modules/TCGClient/Sources/TCGClient/openapi.yaml` → `just check-spec` green. Then build TCGClient once (`swift build` in `app/Modules/TCGClient`) and read the generated operation names in `.build` (expected shape: `getAppApiCards`, `postAppApiCards`, `putAppApiCardsCardId`, `deleteAppApiCardsCardId` — confirm exact casing before writing the impl; never edit generated sources).

---

## Phase 4 — TCGClient additions

Follow the repo `tcg-client-endpoint` skill. New files under `app/Modules/TCGClient/Sources/TCGClient/`:

- `Models/Card.swift` — `public enum CardGame: String, Codable, Hashable, Sendable, CaseIterable { case onePiece = "one_piece", pokemon }`; `public enum CardCondition: String, Codable, Hashable, Sendable, CaseIterable { case mint, nearMint = "near_mint", excellent, good, played, damaged }`; `public struct CardConditionQuantity: Codable, Hashable, Sendable { condition, quantity }`; `public struct Card: Codable, Hashable, Identifiable, Sendable { id, game, name, setName, cardNumber, notes: String?, quantities, createdAt: Date, updatedAt: Date }` — all with public inits.
- `Payloads/Cards/UpsertCardPayload.swift` — `public struct UpsertCardPayload: Codable, Equatable, Sendable { game, name, setName, cardNumber, notes: String?, quantities: [CardConditionQuantity] }`.
- `Errors/Cards/` — mirror `Errors/Auth/SessionErrors.swift` (`.unknown(status:payload:cause:)` with identical associated types):
  - `ListCardsErrors`: `.unauthorized`, `.unknown(...)`
  - `CreateCardErrors`: `.badRequest(validations: [TCGClientValidationIssue])`, `.unauthorized`, `.unknown(...)`
  - `UpdateCardErrors`: `.badRequest(validations:)`, `.notFound`, `.unauthorized`, `.unknown(...)`
  - `DeleteCardErrors`: `.notFound`, `.unauthorized`, `.unknown(...)`
- `TCGCardsClient.swift`:
  ```swift
  public protocol TCGCardsClient: Sendable {
      func list() async -> Result<[Card], ListCardsErrors>
      func create(with payload: UpsertCardPayload) async -> Result<Card, CreateCardErrors>
      func update(id: String, with payload: UpsertCardPayload) async -> Result<Card, UpdateCardErrors>
      func delete(id: String) async -> Result<Void, DeleteCardErrors>
  }
  ```
  `TCGCardsClientImpl` mirrors `TCGAuthClientImpl`: generated `Client` ops only (never hand-built HTTP), transport failures → `.unknown`, `.badRequest` → `TCGClientValidationErrorParser.parseIssues`, **404 disambiguation by body `code`** (`CARD_NOT_FOUND` → `.notFound`, else → `.unauthorized`), `.undocumented` → `.unknown`. Bearer auth comes from the existing `SessionAuthorizationMiddleware` — nothing extra.
- `Preview/PreviewTCGCardsOutcome.swift` — `.success(cards: [Card])`, `.empty`, `.validationErrors([TCGClientValidationIssue])`, `.notFound`, `.serverUnavailable`.
- `Preview/PreviewTCGCardsClient.swift` — `struct PreviewTCGCardsClient: TCGCardsClient` holding `OSAllocatedUnfairLock<[Card]>` (import `os`; NO `@unchecked Sendable`), seeded from the outcome. Deterministic: fixed dates (`Date(timeIntervalSince1970: 1_750_000_000)`), ids `"preview-card-N"`. `static let sampleCards: [Card]` — one One Piece card ("Monkey D. Luffy" / "Romance Dawn" / "OP01-003", `[nearMint: 2, played: 1]`, notes nil) and one Pokemon card ("Pikachu" / "Base Set" / "58/102", `[mint: 1]`, notes "First edition").
- `TCGClient.swift` — add `public let cards: TCGCardsClient` to the aggregate; wire `TCGCardsClientImpl` in `default(...)`. Previews: keep every existing signature **byte-identical** (auth call sites/tests untouched); existing designated method delegates with `cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)`; add `preview(cardsOutcome:)` convenience (`hasValidCredentials: true` so the auth gate shows content) and a new designated `preview(hasValidCredentials:authOutcome:cardsOutcome:)`. No default parameter values that could create overload ambiguity.

### TCGClient tests (`app/Modules/TCGClient/Tests/TCGClientTests/`)

`TCGCardsClientTests.swift` — reuse the existing `RequestTransport` actor pattern (records requests, replays stubs; never mock the generated `Client`); assert method/path/operationID, decode captured bodies with the production payload type:

- list: `GET /app-api/cards/` → decodes populated `[Card]` (snake_case→camelCase mapping, dates, quantities); 404 `SESSION_NOT_FOUND` → `.unauthorized`; undocumented 500 → `.unknown(status: 500, ...)`.
- create: `POST /app-api/cards/` with correctly-encoded snake_case body; 201 → `Card`; 400 → `.badRequest(validations:)`; nil-notes round-trip.
- update: `PUT /app-api/cards/{id}` (path includes id); 200 → replaced `Card`; 404 `CARD_NOT_FOUND` → `.notFound`; 404 `SESSION_NOT_FOUND` → `.unauthorized`; 400 → `.badRequest`.
- delete: `DELETE /app-api/cards/{id}`; 200 → success; 404 `CARD_NOT_FOUND` → `.notFound`.

`PreviewTCGCardsClientTests.swift` — one test per outcome/behavior (standing rule): `.success` seeds sampleCards; `.empty` lists `[]`; create appends and list reflects it; update replaces; update unknown id → `.notFound`; delete removes; `.validationErrors` → create `.badRequest`; `.notFound` → update/delete fail; `.serverUnavailable` → all ops `.unknown`.

**Verify:** `swift test` in `app/Modules/TCGClient`.

---

## Phase 5 — Design-system extraction (`app/Modules/TCGDesignSystem`)

`TCGFeatures` already depends on `TCGDesignSystem`; no Package.swift dependency changes needed.

- `Sources/TCGDesignSystem/TCGFormField.swift` — public, **body byte-identical** to `TCGAuthSignInField` (`app/Modules/TCGFeatures/Sources/TCGAuth/Views/SupportViews/TCGAuthSignInField.swift`): `VStack(alignment: .leading, spacing: 6)` → `Text(label).font(.headline)` → `field.textFieldStyle(.roundedBorder)` → optional `Text(error).font(.caption).foregroundStyle(.red).accessibilityLabel("Error: \(error)")`. `public init(label: LocalizedStringKey, error: String?, @ViewBuilder field: () -> Field)`.
- `Sources/TCGDesignSystem/TCGSubmitButton.swift` — `public init(title: String, isLoading: Bool, action: @escaping () -> Void)`; body reproduces the auth submit button exactly: `Button(action:)` with `HStack { if isLoading { ProgressView().controlSize(.small) }; Text(title).frame(maxWidth: .infinity) }`, `.buttonStyle(.borderedProminent).controlSize(.large).disabled(isLoading)` — copy the exact hierarchy from `TCGAuthSignInScreen.swift` lines ~92–104 (verify against the current file when implementing so it stays pixel-identical).
- Keep `View+Toast.swift` unchanged.

Refactor TCGAuth: delete `TCGAuthSignInField.swift`; in `TCGAuthSignInScreen.swift` replace `TCGAuthSignInField(...)` → `TCGFormField(...)` and the inline submit button → `TCGSubmitButton(title: model.mode.title, isLoading: model.isSubmitting, action: submit)` (preserve any surrounding modifiers exactly).

**Localization risk (verified):** `TCGAuth` has a `Localizable.xcstrings`; `TCGDesignSystem` has none, so `Text(label)` inside `TCGFormField` resolves against the design-system bundle and falls back to the key literal. Since auth keys ("Name", "Email", …) equal the English text, rendering is identical. **Gate:** run `just test-snapshots-macos && just test-snapshots-ios` immediately after this refactor with NO recording; `git status` must show `TCGAuthTests/__Snapshots__/` untouched. If any auth baseline fails, change `TCGFormField` to accept `Text`/`String` instead — do not re-record auth baselines.

---

## Phase 6 — Feature slice `TCGCards`

### Package.swift changes

- `app/Modules/TCGFeatures/Package.swift`: add product `.library(name: "TCGCards", targets: ["TCGCards"])`; target `TCGCards` with the same deps + `swiftSettings` (`ApproachableConcurrency`, warnings-as-errors) as `TCGAuth` (KamaalUI, KamaalUtils, KamaalLogger, TCGDesignSystem, TCGClient); testTarget `TCGCardsTests` mirroring `TCGAuthTests` (deps: TCGCards, TCGClient, SnapshotTesting; `exclude: ["__Snapshots__"]`).
- `app/Modules/TCGApp/Package.swift`: add `.product(name: "TCGCards", package: "TCGFeatures")`.

### Files (`TCGFeatures/Sources/TCGCards/`) — mirror TCGAuth's layout

- `TCGCards.swift` — `@MainActor @Observable public final class TCGCards`: `init(client: TCGClient)` (internal — used by tests/snapshots with `.preview(cardsOutcome:)`), `public static func `default`() -> TCGCards`. State: `private(set) var cards: [Card]`, `private(set) var isLoading`. Ops returning `Result<Void, TCGCardsOperationError>`: `loadCards()`, `addCard(_:)`, `updateCard(id:values:)`, `deleteCard(id:)` — map client errors (`.badRequest` → `.validation(issues)`, `.notFound` → `.notFound`, `.unauthorized`/`.unknown` → `.serverUnavailable`), mutate `cards` locally on success (append/replace/remove), log via KamaalLogger like `TCGAuth.swift`.
- `TCGCardsEnvironment.swift` — `public func tcgCards(_ cards: TCGCards) -> some View` (plain `.environment` modifier, no gating).
- `Models/CardFormValues.swift` — `game: CardGame`, `name/setName/cardNumber: String`, `notes: String`, `quantities: [CardCondition: Int]`; maps to `UpsertCardPayload` (drop zero quantities, trim strings, empty notes → nil).
- `Models/TCGCardsOperationError.swift` — `.validation([TCGCardsValidationIssue])`, `.notFound`, `.serverUnavailable`; `LocalizedError, Equatable` like `TCGAuthOperationError`.
- `Models/TCGCardsValidationIssue.swift` — issue struct + `TCGCardsValidationField` enum with raw values matching server field paths (`name`, `set_name`, `card_number`, `quantities`, `notes`) for server-issue mapping, like `TCGAuthValidationField`.
- `TCGCardsValidator.swift` — stateless: name/setName ≤200 non-empty, cardNumber ≤50 non-empty, notes ≤2000, at least one condition with quantity ≥1, each quantity 0...999.
- `Views/Screens/TCGCardsListScreen.swift` — `@Environment(TCGCards.self)`, injectable `init(model:)`; `List` of rows (name, "set • number", game badge, total quantity), `.onDelete` → delete; game filter (All / One Piece / Pokemon) in the model; toolbar `+` → `.sheet` with `TCGCardFormScreen(mode: .add)`; row tap → `.sheet(item:)` with `.edit(card)`; empty state `ContentUnavailableView`; `.task { await model.load(using:) }`; toast for load/delete failures (auth toast pattern, 3s auto-dismiss).
- `Views/TCGCardsListScreenModel.swift` — `@MainActor @Observable`: `gameFilter: CardGame?`, `presentedForm: CardFormRoute?` (`enum CardFormRoute: Identifiable { case add; case edit(Card) }`), `private(set) toast` with `@ObservationIgnored` auto-dismiss Task, `filteredCards(_:)`, `load(using:)`, `delete(_:using:)`.
- `Views/Screens/TCGCardFormScreen.swift` — shared add/edit form: game `Picker` over `CardGame.allCases`, `TCGFormField` for name/set/number, quantities section with `Stepper` per `CardCondition` (0...999), notes via `TCGFormField` + `TextField(axis: .vertical)`, `TCGSubmitButton`; dismiss on success via `@Environment(\.dismiss)`.
- `Views/TCGCardFormScreenModel.swift` — `init(mode: Mode)` (`.add` / `.edit(Card)` with prefill incl. quantity dictionary); `didSet` re-validation after first submit, `private(set) fieldErrors: [TCGCardsValidationField: String]`, `isSubmitting`, `toast`; `submit(using:) async -> Bool`.
- `Models/CardGame+Presentation.swift`, `CardCondition+Presentation.swift` — localized `title` via `String(localized:)`.
- `Localizable.xcstrings` (TCGAuth has one — follow suit), `ModuleConfig.swift` (copy TCGAuth's, incl. `toastDismissalDelay`).

### Mount in TCGApp (`app/Modules/TCGApp/Sources/TCGApp/TCGApp.swift`)

Replace the placeholder `ContentView`:

```swift
public struct TCGScene: Scene {
    @State private var auth = TCGAuth.default()
    @State private var cards = TCGCards.default()

    public var body: some Scene {
        WindowGroup {
            NavigationStack { TCGCardsListScreen() }
                .tcgCards(cards)
                .tcgAuth(auth)
        }
    }
}
```

`.tcgAuth` keeps gating: sign-in stack when logged out, the card list when logged in.

---

## Phase 7 — App tests (`TCGFeatures/Tests/TCGCardsTests/`)

- `TCGCardFormScreenModelTests.swift` — Swift Testing, `@MainActor`, no branching, one real assertion path per test: empty name / set name / card number errors; all-zero quantities error; valid add submit returns true; edit prefill; server `.validationErrors` maps to `set_name` field error; `.serverUnavailable` sets toast; `isSubmitting` false after completion.
- `TCGCardsFeatureTests.swift` — `TCGCards(client: .preview(cardsOutcome:))`: load populates sampleCards; `.empty` → empty; add appends; update replaces; delete removes; `.serverUnavailable` load → `.failure(.serverUnavailable)`; `.notFound` update → `.failure(.notFound)`.
- `TCGCardsListScreenSnapshotTests.swift` + `TCGCardFormScreenSnapshotTests.swift` — copy the assertion helper from `TCGAuthSignInScreenSnapshotTests.swift` verbatim: light+dark loop; macOS `NSHostingView` 1280×960 + `NSAppearance`, `named: "\(scheme)"`; iOS `.image(layout: .device(config: .iPhone13), traits: UITraitCollection(userInterfaceStyle:))`, `named: "iPhone-\(scheme)"`; `testName: #function`. Screens wrapped in `NavigationStack` + `.environment(cardsFeature)`, state driven via `TCGClient.preview(cardsOutcome:)` (never RequestTransport stubs). Cases: list populated (both games), list empty, list filtered to One Piece (set `gameFilter` on the model), form add empty, form edit prefilled (use a card obtained through the preview client so dates stay deterministic), form with validation errors (submit with empty fields).
- `app/TCG.xctestplan` — add `{ containerPath: "container:Modules/TCGFeatures", identifier: "TCGCardsTests", name: "TCGCardsTests" }` (match the existing TCGAuthTests entry's shape).
- `justfile` — extend `test-snapshots-macos` / `test-snapshots-ios` with `-only-testing:TCGCardsTests/TCGCardsListScreenSnapshotTests -only-testing:TCGCardsTests/TCGCardFormScreenSnapshotTests` alongside the existing auth entry.

---

## Phase 8 — Execution order + verification

1. **DB** (Phase 1) → `just make-migrations`, `just start-services`, `just migrate`.
2. **Server slice + integration tests** (Phase 2) → `just test-server`, `just typecheck`, `just lint`, `just format-check-js`.
3. **Spec** (Phase 3) → `just download-spec`, commit `openapi.yaml`, `just check-spec`; inspect generated operation names.
4. **TCGClient** (Phase 4; use the `tcg-client-endpoint` skill) → `swift test` in `app/Modules/TCGClient`.
5. **Design-system extraction + auth refactor** (Phase 5) → `just test-snapshots-macos && just test-snapshots-ios` with **no recording**; `TCGAuthTests/__Snapshots__/` must be byte-identical (`git status` clean). Never re-record auth baselines.
6. **TCGCards feature + TCGApp mount + unit tests** (Phases 6–7) → `just test-app`.
7. **Record new baselines** for the two TCGCards snapshot suites only (use the repo `swift-snapshot-testing` skill; iOS destination `platform=iOS Simulator,OS=27.0,name=iPhone 17`), then re-run `just test-snapshots` without record mode; visually inspect and commit the new PNGs.
8. **Final gate:** `just ready` — must pass before claiming completion.

---

## Open risks / decisions

1. **Relations merge** — spreading `{...authRelations, ...cardsRelations}` is safe only because the cards part emits no `user` key; if a `user.cards` relation is wanted later, merge the `user` entries manually.
2. **Trailing slash** — `path: '/'` under the mounted router yields spec path `/app-api/cards/`; confirm Hono matches `/app-api/cards` in integration tests and confirm generated Swift operation names before writing the impl.
3. **Unauthenticated = 404 `SESSION_NOT_FOUND`** collides with `CARD_NOT_FOUND` on status — client branches on `code`; keep this covered in transport-boundary tests.
4. **`LocalizedStringKey` bundle shift** in `TCGFormField` — mitigated (keys equal English text); the no-record snapshot run in step 5 is the gate; fall back to `Text`/`String` parameter if it fails.
5. **No 204 in `STATUS_CODES`** — delete returns 200 `{}` mirroring sign-out; extending `src/constants/http.ts` is possible but unnecessary.
6. **Two `TCGClient.default()` instances** (auth + cards features) mirrors the current architecture (separate URLSession stacks); acceptable for MVP — could later share one injected client.

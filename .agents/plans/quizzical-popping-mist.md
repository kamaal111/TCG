# Cache Scrydex card images in our own object storage

## Context

Card images today come straight from Scrydex's CDN. `normalizeScrydexCard` pulls an origin URL
into `pricing.image` (`server/src/card-pricing/scrydex/normalize.ts`), and `serializePricedCard`
emits it verbatim as `image_url` (`server/src/card-pricing/utils/pricing.ts:45`). Nothing ever
downloads the bytes, and the Swift app doesn't render images at all yet — `PricedCard.imageURL`
is carried through `PricedCardMapper.swift` and then dropped on the floor.

We want the bytes cached in storage we control, served from our own domain, so we aren't
hotlinking a third party's CDN and aren't at the mercy of their availability or URL churn.
Deployment doesn't exist yet, so this runs on MinIO locally — but the storage layer must be a
port with swappable adapters, so moving to S3 or GCS is a credentials-and-endpoint change rather
than a code change.

### Decisions (settled — do not re-litigate)

| Decision | Choice |
|---|---|
| Client-facing URL | Stable server proxy: `image_url` is always ours, never Scrydex |
| Bucket access | Private — only the server reads it |
| Proxy delivery | Stream bytes through the server, `immutable` + strong `ETag` + 304 |
| Proxy auth | **Unauthenticated** (enables `Cache-Control: public`; keeps the Swift loader trivial) |
| App scope | Thumbnails in both `PricedCardRow` (search) and `CardRow` (collection) |

Cold start is solved by making the cold path *serve* the fetch it triggers: the proxy buffers the
origin response once, then uses it twice — writes it to storage and returns it in the same
response. Nobody ever waits for a round trip they didn't need. A background warmer additionally
pre-fills images right after a pricing search, so most images are warm before anyone asks.

---

## Part 1 — Infrastructure

### `docker-compose.yaml`

Add a `minio` service (pin the `RELEASE.*` tag; `:latest` will silently break the healthcheck):

- `command: server /data --console-address ":9001"`
- Root creds from `TCG_STORAGE_ROOT_USER` / `TCG_STORAGE_ROOT_PASSWORD`, defaults in the
  `TCG_DB_*` style already used by postgres
- Ports `${TCG_STORAGE_PORT:-9000}` and `${TCG_STORAGE_CONSOLE_PORT:-9001}`
- Named volume `minio_data:/data`
- Healthcheck `['CMD', 'mc', 'ready', 'local']` — **verify against the pinned tag**; fallback is
  `curl -f http://localhost:9000/minio/health/live`

Add a `minio-init` one-shot container behind `profiles: ['tools']` that runs `mc alias set`,
`mc mb --ignore-existing`, and `mc anonymous set none` (the last explicitly asserting the
private-bucket decision rather than trusting the default).

**Why a profile:** `docker compose up -d --wait` and one-shot containers interact badly across
compose versions — `--wait` can hang or error on a container that exits. Keeping the init
container out of the default profile sidesteps it entirely. `justfile` `start-services` becomes:

```make
start-services:
    docker compose up -d --wait
    docker compose run --rm minio-init
```

Idempotent, deterministic, version-independent.

**Why an init container over creating the bucket on boot:** boot-time creation means the
production IAM principal carries `s3:CreateBucket` forever for a one-time act, and in prod the
bucket will be Terraform/console-created anyway — so it'd be dead code everywhere but local.

### `.env.example`

Two deliberately separate prefixes, mirroring the existing `TCG_DB_*` vs `DATABASE_URL` split:
`TCG_STORAGE_*` for compose, `OBJECT_STORAGE_*` for the server. All server keys are optional or
defaulted so an existing `.env` keeps working untouched.

---

## Part 2 — Storage port (`server/src/storage/`)

A structural mirror of `card-pricing/client.ts` — the existing ports/adapters precedent.

**`client.ts`** — `ObjectStorageClient` with `put` / `get` / `head` / `delete`, all returning
`neverthrow` Results over a structured `ObjectStorageError { reason, message, statusCode?,
isRetryable }`. Reasons: `access_denied`, `invalid_response`, `missing_credentials`,
`network_error`, `not_found`, `request_timeout`, `unknown`. `Uint8Array` bodies throughout —
not streams (see the cold-path note in Part 4).

**`s3-client.ts`** — `S3ObjectStorageClient` on `@aws-sdk/client-s3`, covering MinIO, AWS S3, and
GCS's S3-compatible XML API. An injectable `clientFactory` is the test seam, exactly as
`RealScrydexClient` injects `fetch`. Three details that matter:

- **`forcePathStyle: true` is required for MinIO** — virtual-hosted addressing would resolve
  `tcg-card-images.localhost:9000`. Expose as `OBJECT_STORAGE_FORCE_PATH_STYLE`, default true.
- **Set `requestChecksumCalculation: 'WHEN_REQUIRED'` and `responseChecksumValidation:
  'WHEN_REQUIRED'`.** Recent SDK versions send `x-amz-checksum-crc32` on every `PutObject`, which
  several S3-compatible stores reject. This is the single most likely "works locally, 400 in
  staging" failure — comment it at the call site.
- Store the sha256 as `Metadata: { checksum }` rather than relying on S3's native
  `ChecksumSHA256`, which GCS's XML API doesn't expose identically.

Missing credentials return `missing_credentials` *without* calling `send`, mirroring
`RealScrydexClient.headers()`.

**`memory-client.ts`** — `InMemoryObjectStorageClient` over a `Map`. This is the **dev/default**
implementation (so `new App()` in the spec scripts stays hermetic and `just dev-server` works
without MinIO), *not* what integration tests use — those run against a real MinIO container. It
also backs targeted error-injection wrappers in unit tests. `delete` of an unknown key resolves
`ok` (idempotent, matching S3).

**`factory.ts`** — `createObjectStorageClient()`, an exact copy of `scrydex/factory.ts`.

**Dependencies:**
- `@aws-sdk/client-s3` (dependency) — root `package.json` gets the real version,
  `server/package.json` gets `workspace:*`. No `lib-storage` (we buffer), no image library (we
  never decode). ~20 MB of transitive deps; the alternative is hand-rolling SigV4 and owning
  signing, retries, and every provider quirk forever, which undercuts the swap-providers goal.
- `@testcontainers/minio` (devDependency) — spins the real MinIO used by integration tests. Falls
  back to `GenericContainer` from `testcontainers` if the dedicated module is awkward.

**`env.ts`** — add `OBJECT_STORAGE_*` keys plus `CARD_IMAGE_*` tuning knobs, following the
`SCRYDEX_CLIENT` precedent: enum mode defaulting to the non-network implementation (`memory`),
optional credentials, and a `superRefine` requiring them when mode is `s3`. Put
`OBJECT_STORAGE_PROVIDERS` in `constants/common.ts` next to `PRICING_CLIENT_MODES`.

Two traps:
- **Every new key must be optional or defaulted.** `env.ts` is parsed eagerly at import *and*
  `drizzle.config.ts` imports it — a required key breaks `drizzle-kit generate`, every vitest
  file, and the spec scripts with a Zod error that looks unrelated.
- **Do not copy `z.coerce.boolean()`** (used for `DEBUG`) — it's truthy for the string `"false"`.
  Use `z.stringbool()`.

Add `PUBLIC_BASE_URL`, defaulting to `BETTER_AUTH_URL`. Auth issuer and public asset host diverge
in production, and `image_url` is now our own absolute URL.

---

## Part 3 — Image cache domain (`server/src/card-images/`)

Directory `card-images`; log/route domain **`images`** — `logging/tests/events.test.ts` enforces
`/^[a-z]+(?:\.[a-z][a-z_]*)+$/`, so the first segment cannot contain an underscore.

### Table — `server/src/db/schema/card-images.ts`

`card_image`, keyed by `image_key` = sha256 hex of the **origin URL**:

- `image_key` (unique), `origin_url`, `storage_key`
- `status` enum `pending | ready | failed`
- `content_type`, `content_length`, `checksum` (sha256 of the *bytes* → the strong ETag)
- `attempt_count`, `last_error`, `last_attempted_at`, `stored_at`, timestamps
- Unique index on `image_key`; index on `(status, last_attempted_at)` for retry backoff
- A `check` constraint asserting `status = 'ready'` implies content type, length, and checksum are
  all non-null — the DB-level statement of the invariant the ETag path depends on

Hashing the origin URL is what makes the proxy URL genuinely content-addressed: the same art
across days and across searches yields the same key, so dedupe and re-pricing survival fall out
for free. No `user_id`, no FK to `card_price` — this is a **global** cache of third-party bytes,
which is also why the proxy is unauthenticated.

### `keys.ts` — pure, no DB, no context

`imageKeyForOriginURL` (sha256 hex), `storageKeyForImageKey` (`card-images/ab/cd/<key>` — sharded
so `mc ls` stays sane), `imageProxyURL`, `proxyURLForOriginURL`.

**The proxy URL must be absolute** — `PricedCardSchema.image_url` is `z.url()`, so a relative path
throws at `parse`. Build it against `PUBLIC_BASE_URL`.

This file must import nothing from `card-pricing/`; `card-pricing/utils/pricing.ts` imports *it*.

### Serialization — one line

```ts
image_url: row.prices.image == null ? undefined : proxyURLForOriginURL(row.prices.image),
```

Pure hash, zero DB lookups on the read path. All four `serializePricedCard` call sites inherit it.
Also update the `image_url` `.meta({ example })` in `card-pricing/schemas/responses.ts` — this
changes `openapi.yaml` and mandates `just download-spec`.

### Registration — write-on-write, not write-on-read

Two sites in `CardPricingService` persist prices and already hold the normalized cards, both
already inside `withPricingLock`:

1. `searchAndPrice`, after `upsertCardPrices`, before `upsertSearch`
2. `priceOwnedCardById`, after `upsertCardPrice`

Add a private `registerImages(rows)` that does one `INSERT … ON CONFLICT (image_key) DO NOTHING
RETURNING *` and then synchronously `enqueue`s the inserted rows on the warmer. **The whole body
is wrapped in try/catch and never rethrows** — cache warming must never fail a pricing request.
Cache-hit paths correctly do nothing; rows were registered when the price was first written and
`card_image` never expires.

### Repository — `repository.ts`

`getByImageKey`, `registerMany`, `markReady`, `markFailed`, `listPending`, `withImageLock`.

**Deviation from repository-per-slice, flagged as a decision not a slip:** this repository takes
`{ db }` with a `fromContext(c)` factory, rather than a `HonoContext`. The background warmer
outlives the request that queued it and has no context. All DB access still goes through the slice
repository — only the constructor argument widens — and it's safe here precisely because
`card_image` isn't user-scoped, so there's no `getSession(this.c)` to lose. The alternative is a
duplicate `BackgroundCardImageRepository`, which is worse.

`withImageLock` **copies** the `withPricingLock` pattern rather than reusing it: `withPricingLock`
requires `{ game, pricedOn }` for its logging, emits `pricing.lock.completed`, and throws
`PricingLockTimeout` — all wrong here. ~20 lines: `set_config('lock_timeout', …, true)` →
`pg_advisory_xact_lock(hashtextextended('card-image:' || key, 0))` → operation;
`classifyPostgresError(...) === 'lock_not_available'` → throw `CardImageBusy`.

### Origin client — `origin-client.ts`

The "tests never touch the network" seam, and a **port** rather than a bare injected `fetch`, so
tests can count calls and gate resolution. `HttpCardImageOriginClient` mirrors `RealScrydexClient`:
injectable `fetch`, `AbortSignal.timeout`, timeout/abort → `request_timeout`, non-2xx →
`http_error` with `isRetryable = status === 429 || status >= 500`.

Plus two guards that keep this from becoming an open proxy for arbitrary content: reject
`Content-Length > CARD_IMAGE_MAX_BYTES` before reading *and* re-check after, and validate
`Content-Type` against an allowlist (`image/png`, `image/jpeg`, `image/webp`, `image/avif`,
`image/gif`).

### Warmer — `warmer.ts`

A **process singleton owned by `createApp`** (not per-request), injected onto the context
alongside everything else. Holds no timers and starts no work at construction, so `new App(...)`
in tests and in `scripts/download-openapi-spec.ts` stays inert.

- `enqueue(jobs)` — synchronous, never throws, never awaited. Dedupes against an in-flight `Set`
  and the queue's own key set, then pumps workers up to `CARD_IMAGE_WARM_CONCURRENCY`.
- Each worker is launched as `void this.runWorker().catch(...)` and each job body is fully
  try/caught — a throwing storage client or malformed row **cannot** crash the process or
  propagate into the HTTP response that queued it.
- Each job runs inside `withImageLock` and **re-reads the row first**; if another process already
  marked it `ready`, it returns without fetching. `CardImageBusy` is swallowed as a no-op.
- Respects `attemptCount >= CARD_IMAGE_MAX_ATTEMPTS` and `lastAttemptedAt` within
  `CARD_IMAGE_RETRY_AFTER_MS`.
- Uses the process logger, never `c.get('logger')` — it isn't request-scoped.

**Test determinism — no sleeping, ever.** Two mechanisms, both used:
1. `CARD_IMAGE_WARM_ON_REGISTER: 'false'` in `vitest.config.ts`, so implicit warming never fires
   during unrelated suites and the pricing tests stay exactly as deterministic as today.
2. `await warmer.idle()` — resolves immediately when the queue is empty, otherwise via resolvers
   drained when the last worker exits. Tests do `enqueue(); await idle(); expect(...)`.

**Boot warming is deliberately out of scope for v1.** There's no leader election, so N instances
would each fetch every pending image on startup; the proxy's cold path already self-heals on first
request; and it adds a startup failure mode to `App.serve()`. `listPending()` and the
`(status, last_attempted_at)` index exist so it can be added later behind a flag in one file.

---

## Part 4 — The proxy endpoint

`GET /app-api/images/{imageKey}` — mounted under `/app-api` but **without**
`requireSessionMiddleware`.

The abuse vector that actually matters is closed structurally: the endpoint takes a *key*, looks
it up, and 404s if absent. It never accepts an arbitrary origin URL, and rows are only ever created
by our own pricing pipeline — so it cannot be turned into an open proxy.

### OpenAPI: `hide: true`

`RouteConfig` in `@kamaalio/hono-standard-openapi@0.0.15` supports `hide?: boolean` — *"Keeps the
route out of the generated document while still serving it."* So the slice keeps all its
conventions (`routes/`, `handlers/`, param validation via the shared `defaultHook`), the route
serves normally, and `openapi.yaml` never mentions it — meaning swift-openapi-generator never
generates an unused binary-response method and `just check-spec` never churns.

*Fallback if `hide` misbehaves:* a plain `new Hono<HonoEnvironment>()` router mounted with
`.route()`, exactly like `server/src/health/index.ts`. Costs manual key validation in the handler.

### Handler algorithm

```
1. imageKey ← param, validated /^[0-9a-f]{64}$/  → 400 on garbage
2. row ← getByImageKey(imageKey);  null → 404 CARD_IMAGE_NOT_FOUND
3. status === 'ready':
     etag = "<checksum>"
     If-None-Match matches → 304, headers only, NO storage call
     storage.get → ok: 200 + bytes
                 → not_found: fall through to (4)   // bucket drifted from DB; self-heal
                 → else: 503 CARD_IMAGE_STORAGE_UNAVAILABLE, Retry-After: 1
4. cold path:
     failed && attempts >= MAX && within RETRY_AFTER → 404  (stop hammering a dead origin)
     withImageLock(imageKey):
        re-read under lock; if now 'ready' → storage.get → 200
        originClient.fetchImage → err: markFailed; 502 CARD_IMAGE_ORIGIN_UNAVAILABLE
        checksum = sha256(bytes)
        storage.put → ok ? markReady : markFailed
        → 200 + bytes  REGARDLESS of the put outcome
     CardImageBusy → 503, Retry-After: 1
5. headers: Content-Type, Content-Length, ETag: "<checksum>",
            Cache-Control: public, max-age=31536000, immutable
```

**Buffer once, use twice — not a stream tee.** `PutObjectCommand` with a `ReadableStream` body and
no `ContentLength` fails in Node (fixing it means `lib-storage` and multipart uploads for 200 KB
files); a real tee also prevents computing the sha256 ETag before headers go out. Card art is
100–500 KB, capped at 5 MB. Buffering gives one code path, exact `Content-Length`, and a correct
strong ETag.

**If `storage.put` fails but the fetch succeeded, still return the bytes** and mark the row
`failed` for later retry. The user got their image; the cache miss is our problem.

### Two cross-cutting edits

- **Skip global compression for this path.** `createApp`'s `.use(compress())` would gzip PNG/JPEG
  for ~0% gain and, worse, drop `Content-Length` in favour of chunked encoding. Wrap it:
  `c.req.path.startsWith(IMAGES_PATH_PREFIX) ? next() : compressMiddleware(c, next)`.
- **Add `BAD_GATEWAY: 502` to `server/src/constants/http.ts`** (it doesn't exist). 502 = our
  upstream origin failed; 503 = we're busy or our storage is down. The distinction matters for
  client retry logic and log triage.

### Exceptions, logging, wiring

`exceptions.ts` follows `card-pricing/exceptions.ts`: `CardImageNotFound` (404), `CardImageBusy`
(503 + `Retry-After: 1`), `CardImageOriginUnavailable` (502), `CardImageStorageUnavailable` (503 +
`Retry-After: 1`).

`logging.ts` declares `IMAGES_EVENTS` = `images.register`, `images.proxy.completed`,
`images.warm.queued`, `images.warm.completed`, `images.storage.completed`, `images.lock.completed`,
plus an explicitly enumerated `ImagesLogFields`. **`origin_url` is deliberately absent** from the
vocabulary — same discipline as `lock_key_type` vs `lock_key`; log `image_key` (a hash) instead.
Reuse existing field names (`cache_status`, `result_count`, `lock_*`) per `docs/logging.md`.

Then: register `['images', IMAGES_EVENTS]` in `logging/tests/events.test.ts`, and add
`ImagesLogFields` to the `AnyLogFields` union in `logging/index.ts` — otherwise `authModule`'s
`logger: c => c.get('logger')` narrows wrong.

Wiring: extend `InjectedContext`, `createApp` overrides, and the `App` constructor with
`storageClient`, `imageOriginClient`, `cardImageWarmer`; set the repository and service in
`injectRequestContext`; mount the router in `app-api/index.ts`.

---

## Part 5 — The app

### The hard constraint

`assertScreenSnapshot` (`TCGSnapshotTesting/ScreenSnapshotAssertion.swift`) is **fully
synchronous** — it calls `assertSnapshot(of: screen(), ...)` immediately. Any `.task`-driven async
image load will not have completed at capture time, so a plain `AsyncImage` would snapshot its
placeholder nondeterministically.

The design therefore gives the loader a **synchronous cache-hit path** that the view consults
during `body`. This is what makes snapshots deterministic, and it independently makes production
scrolling smooth (no placeholder flash for already-decoded images).

### New: `TCGDesignSystem/Sources/TCGDesignSystem/CardImage/`

`TCGDesignSystem` already reaches `TCGClient` transitively (`TCGDesignSystem → TCGModels →
TCGClient`), but the view takes a plain `URL?` so it stays dependency-light.

```swift
public protocol CardImageLoader: Sendable {
    /// Already-decoded image, or nil. Must not perform I/O — called during `body`.
    func cachedImage(for url: URL) -> Image?
    func image(for url: URL) async -> Image?
}
```

- **`URLSessionCardImageLoader`** — the real one. A `URLSession` configured with a disk-backed
  `URLCache` (~32 MB memory / 256 MB disk); the server's `immutable` header does the rest, so
  there's no hand-rolled disk cache. On top sits a small decoded-image cache so repeated rows
  don't re-decode.

  **The decoded cache uses `OSAllocatedUnfairLock<[URL: Image]>` with a bounded count, not
  `NSCache`** — `NSCache` isn't `Sendable`, and `@unchecked Sendable` is off the table in shipped
  code. An actor won't work either, since `cachedImage` must be synchronous.

- **`PreviewCardImageLoader`** — deterministic, synchronous, zero I/O. Renders a solid colour
  derived from the URL. **Derive it with an explicit stable hash (FNV/djb2 over the URL's UTF-8
  bytes), never Swift's `hashValue`** — `Hasher` is randomly seeded per process, so baselines
  would differ between runs. Outcomes: `.success`, `.failure`, `.loading`.

- **`CardImageView`** — `content` resolves `loaded ?? loader.cachedImage(for: url)`, so a preview
  loader renders on the first pass. Falls back to a rounded placeholder with a `photo` symbol, and
  kicks off `.task(id: url)` for the real async path. Fixed frame at card aspect ratio (~44×61).

- Environment key + `.cardImageLoader(_:)` modifier, defaulting to the real loader.

### Modified views

- `TCGSearch/Views/PricedCardRow.swift` — leading `CardImageView(url: card.imageURL...)` inside
  the existing `HStack`.
- `TCGCards/Views/CardRow.swift` — same, from `cardWithPrice.price`'s priced card.

### Preview clients

- Add `imageURL` values to `PreviewTCGPricingClient.samplePricedCards` (currently `nil`, so
  images would be invisible in baselines). `PreviewTCGCardsClient.price(for:)` already links to
  those samples and inherits it.
- Per the repo convention that preview-client behaviour is itself unit-tested, add
  `PreviewCardImageLoaderTests` — the same URL yields an identical image across calls, different
  URLs differ, `.failure` returns nil, `cachedImage` performs no I/O. Simplest home is
  `TCGSearchTests` with `TCGDesignSystem` added to its dependencies; a dedicated
  `TCGDesignSystemTests` target is cleaner long-term but also needs a `TCG.xctestplan` edit.

### Snapshots

Inject `.cardImageLoader(PreviewCardImageLoader(outcome: .success))` in the `makeScreen` helpers of
both suites, then **re-record all baselines** for `TCGSearchTests` and `TCGCardsTests` — light and
dark, macOS and iOS (4 PNGs per test). Use `just test-snapshots-macos` / `just test-snapshots-ios`;
see the repo's `swift-snapshot-testing` skill for record mode. Never invoke `xcodebuild` for iOS
directly.

---

## Verification

Run in this order — each step breaks the next if skipped:

```
1. just install-modules          # after editing both package.json files
2. # edit env.ts, vitest.config.ts, .env.example  (all keys optional/defaulted)
3. just start-services           # after the compose + justfile edit
4. just make-migrations && just migrate   # after schema registered in db/schema/index.ts
5. # implement storage/, card-images/, wiring, pricing hooks, tests
6. just download-spec            # commits app/Modules/TCGClient/Sources/TCGClient/openapi.yaml
7. just ready-server
8. just test-snapshots-macos && just test-snapshots-ios   # record, then verify
9. just ready-app
```

**Ordering traps:** deps last → typecheck noise drowns real errors. Env keys required-without-
default → `drizzle-kit`, vitest, and the spec scripts all die at module load. Migration after the
tests → every integration test hits `relation "card_image" does not exist`, since
`createTestDatabase()` migrates per test. `make-migrations` before registering the table in
`db/schema/index.ts` → an empty migration you must delete by hand. `download-spec` before the
`image_url` `.meta()` edit → `check-spec` fails inside `ready-server`.

**Docker is now required to run `just test-server`** — testcontainers starts MinIO for the run.
The compose MinIO is a separate thing: it's for `just dev-server`, and tests never touch it. Local
dev without Docker still works, since `OBJECT_STORAGE_CLIENT` defaults to `memory`.

### Test infrastructure: a real MinIO, fresh per run

Integration tests exercise the **real S3 API against a real MinIO container** — no in-memory
substitute — mirroring how Postgres tests run against a real database. The isolation model layers
the way Postgres's does, one level up:

| | Postgres | MinIO |
|---|---|---|
| Server | long-running compose container | **ephemeral container, one per test run** |
| Namespace | `CREATE DATABASE test_db_<uuid>` per test | `CreateBucket test-bucket-<uuid>` per test |
| Teardown | `DROP DATABASE` on cleanup | delete all objects, then `DeleteBucket` |

**`server/src/tests/global-setup.ts`** (new, wired as vitest `globalSetup`) — starts a
`MinioContainer` on a random host port, then hands its coordinates to the workers via vitest's
`provide()`:

```ts
export default async function setup({ provide }) {
  const container = await new MinioContainer('minio/minio:<pinned>').start();
  provide('minioEndpoint', `http://${container.getHost()}:${container.getMappedPort(9000)}`);
  provide('minioAccessKeyId', ...);
  provide('minioSecretAccessKey', ...);
  return async () => { await container.stop(); };
}
```

**Use `provide()`/`inject()`, not `process.env`.** `env.ts` parses `process.env` eagerly at import
inside every worker, and mutating `process.env` from globalSetup only reaches workers by fork
inheritance — fragile, and pool-dependent. Since fixtures already construct the storage client
explicitly and pass it to `new App({ ... })` (exactly how `pricingClient` is injected today), the
tests never need `env` to know about the container at all. Keep `OBJECT_STORAGE_CLIENT` at its
`memory` default in `TEST_ENV`, so anything that builds a default app stays hermetic.

**`createTestBucket()`** in `server/src/tests/utils.ts`, sitting alongside `createTestDatabase()`
and shaped identically — `{ storageClient, bucket, cleanup }`. It creates a uuid-named bucket via
`@aws-sdk/client-s3` against the injected endpoint, returns a real `S3ObjectStorageClient` bound to
it, and on cleanup lists and deletes every object before deleting the bucket. `forcePathStyle` is
on, which is also what makes the MinIO path exercise the production code path rather than a mock.

**`server/src/tests/fixtures.ts`** gains `storageClient` (real, bucket-scoped),
`imageOriginClient` (a fake — the origin *must* stay off the network), and `cardImageWarmer`,
all passed into `new App({ ... })` and registered as fixtures next to `pricingClient`.

Note the deliberate asymmetry: **storage is real, the image origin is faked.** MinIO is
infrastructure we control and can run locally; Scrydex's CDN is a third party, and the rule that
tests never make external requests still holds.

`globalSetup` needs its own generous timeout for image pull on a cold machine — the existing
15s `testTimeout` does not apply to it.

### Server tests

- `storage/tests/memory-client.test.ts` — round-trip, `not_found`, idempotent delete, overwrite
- `storage/tests/s3-client.test.ts` (**integration, real MinIO**) — put then get returns identical
  bytes and content type; `head` returns metadata; the sha256 survives the round trip as object
  metadata; `get`/`head` of an unknown key map to `not_found` with `isRetryable === false`; delete
  removes it and is idempotent; put overwrites. This is the test that would actually have caught
  the SDK-checksum and path-style problems, which is the whole point of using a real container.
- `storage/tests/s3-client-errors.test.ts` (unit, injected `clientFactory`) — error mapping for
  403 / timeout / unrecognized, and `missing_credentials` returned *without* calling `send`.
  Kept separate because these paths are hard to provoke against a healthy container.
- `card-images/tests/keys.test.ts` — pin the hash literal so the algorithm can't drift silently
- `card-images/tests/warmer.test.ts` — stores into real MinIO + flips the row to `ready` with the
  right checksum/content type/length; triple enqueue → exactly one origin fetch; origin error →
  `failed` with `attempt_count === 1`; a storage client that **throws** still lets `idle()` resolve
  (proves the process can't crash); concurrency cap observed exactly; `ready` and
  exhausted-attempt rows skipped without fetching
- `card-images/tests/register.integration.test.ts` — one row per match with art, all `pending`;
  `image_url` equals `imageProxyURL(imageKeyForOriginURL(...))` by string equality; no art → no
  row; repeat search → still one row
- `card-images/tests/get-image.integration.test.ts` — **a no-header GET returns 200** (pins the
  auth decision); 404 unknown key; 400 malformed key; cold path returns bytes + correct headers,
  leaves the row `ready`, **and the object is genuinely readable back out of MinIO**; warm path
  with `callCount` still 1; 304 on matching `If-None-Match`; 200 on non-matching; origin failure →
  502 + row `failed`; storage down → 503 (wrap the real client to force the error); **storage
  drift** → delete the object out of the bucket directly, then GET → refetch → 200; two concurrent
  cold requests → both 200, identical bytes, `callCount === 1`
- `open-api.integration.test.ts` — assert no path starts with `/app-api/images` (locks in `hide`)

Determinism comes from `warmer.idle()` and gate promises — **no test sleeps, and no test branches
to reach an assertion**.

---

## Risks

1. **MinIO healthcheck** — `mc ready local` is documented but unverified against a pinned tag.
   Fallback noted above. Pin the tag.
2. **AWS SDK default checksums** — the highest-probability production surprise. The real-MinIO
   integration tests should surface it immediately; re-verify before switching to GCS.
3. **Testcontainers on macOS** — it needs a reachable Docker socket, and Colima/Podman/Rancher
   setups often need `DOCKER_HOST` or `TESTCONTAINERS_*` hints that plain Docker Desktop doesn't.
   Worth confirming early, since it gates the whole server suite. Pin the MinIO tag here too, and
   pre-pull it so a cold `globalSetup` doesn't blow its timeout.
4. **`immutable` is a claim about origin-URL stability, not byte stability.** If Scrydex ever
   swaps the bytes behind a cached URL, clients hold stale art for a year. Mitigating properly
   would require fetching before serializing the URL, which defeats the pure-hash design. Accepted;
   card CDN paths are versioned in practice.
5. **`hide: true`** verified from the package's `.d.ts`, not by running it. Fallback documented.
6. **Repository-per-slice deviation** for `CardImageRepository` — a knowing, argued exception.
7. **`SwiftUI.Image` Sendability** across the loader boundary — if it fights the strict-concurrency
   settings (`treatAllWarnings(as: .error)` is on), vend platform image data and convert in the
   view instead.

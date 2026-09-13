# Make card-image storage S3-only and harden the warmer for horizontal scale

## Context

The `Cache card images behind the application proxy` commit (`3fc712c`) added a
card-image cache: a `card_image` table, an object-storage backend, a background
warmer, and an unauthenticated proxy route. A review of that commit for
horizontal-scalability found the core concurrency design sound — claims are
atomic leases in Postgres, writes are lease-fenced, and abandoned work is
reclaimed after lease expiry — but surfaced one configuration landmine and four
rough edges.

The landmine: `OBJECT_STORAGE_CLIENT` defaults to `memory`
(`server/src/env.ts:43`), and `InMemoryObjectStorageClient` is a per-process
`Map`. Deploying two replicas without explicitly setting `s3` produces a silent
thrash loop — instance A materializes and marks the row `ready` in the shared
database, instance B misses in its own memory, calls `resetMissingObject`, flips
the row back to `pending`, and refetches from origin forever. It degrades
quietly instead of failing loudly.

Intended outcome: the in-memory client becomes a test double that production
code physically cannot reach; local development runs against the MinIO service
already defined in `docker-compose.yaml`; and the four rough edges are ironed
out so the service can be scaled horizontally without surprises.

Decisions already taken with the user:
- Move the in-memory client into test-only code rather than gating it at runtime.
- Local dev uses the existing compose MinIO; the server fails fast on missing
  storage configuration rather than silently falling back.
- Do **not** build background revalidation. Images are not expected to change
  upstream, so nothing should re-fetch a `ready` row on a schedule. Part 5 is
  reduced to a manual refresh lever for the case where the bytes we stored were
  wrong to begin with.

A fifth problem surfaced during planning and is now the first thing to fix:
`claim` increments `attempt_count` on every claim while `markReady` never resets
it, so the column counts claims rather than failures and a row can become
permanently unclaimable. That is a live bug today, independent of scaling.

---

## Part 1 — S3 by default, in-memory client test-only

### Move the double out of `src/storage/`

- Move `server/src/storage/memory-client.ts` →
  `server/src/tests/storage/memory-client.ts`, and its unit test
  `server/src/storage/tests/memory-client.test.ts` →
  `server/src/tests/storage/memory-client.test.ts`. It stays a real
  `ObjectStorageClient` implementation; only its location and reachability change.
- Delete `server/src/storage/factory.ts`. With `memory` gone there is only one
  provider, so the ternary and the `OBJECT_STORAGE_CLIENT` env key have nothing
  left to select. `server/src/app.ts:129` becomes
  `overrides.storageClient ?? new S3ObjectStorageClient()`.
- Remove `OBJECT_STORAGE_PROVIDERS` from `server/src/constants/common.ts` and
  `OBJECT_STORAGE_CLIENT` from `server/src/env.ts` and `.env.example`.

This intentionally diverges from the sibling `createPricingClient` factory
pattern (`server/src/card-pricing/scrydex/factory.ts`) — that one keeps a real
runtime choice (`real` vs `static`), this one no longer has one.

### Fail fast on missing configuration

Rework the storage branch of the `.superRefine` in `server/src/env.ts:91-123`:
credentials and `OBJECT_STORAGE_ENDPOINT` become required whenever
`MODE === SERVER_MODES.SERVER`, with messages that name the compose service
(e.g. `OBJECT_STORAGE_ENDPOINT is required; run \`just start-services\` and point
it at the local MinIO on http://localhost:9000`). Keep them optional under
`MODE === TEST` so tests and the OpenAPI scripts need no fake secrets — mirroring
how `IS_TEST` (`env.ts:129`) and `modes.ts:10` already treat test mode as a
first-class branch.

`.env.example` already carries working MinIO values (lines 15-30); drop the
`# Server object-storage adapter. Memory is the default for hermetic
development.` comment and the commented-out `# OBJECT_STORAGE_CLIENT=s3`, and
uncomment the endpoint/credential lines so a fresh clone works after
`just start-services`.

### Inject the double from the test fixture

`server/src/tests/fixtures.ts` currently injects only `db` and `pricingClient`,
so the fixture app silently picked up the env-selected memory client. Add
`storageClient: new InMemoryObjectStorageClient()` to the `new App({...})` call
and expose it as a `storageClient` fixture, so tests can assert against stored
objects. The three tests in
`server/src/card-images/tests/get-image.integration.test.ts` that build their own
`new App({ db, storageClient, ... })` keep working with an import path update.

`server/src/storage/tests/s3-client.integration.test.ts` is unaffected — it
already constructs `S3ObjectStorageClient` with explicit options against a
testcontainers MinIO, bypassing `env` entirely.

### Enforce the boundary with lint

Add an `overrides` entry in `oxlint.config.ts` for `server/src/**` (excluding
`server/src/tests/**` and `server/src/**/tests/**`) using `no-restricted-imports`
to ban paths matching `**/tests/**`. This is cheaper than a custom JS plugin and
makes the rule apply to any future test double, not just this one. The repo
already has custom plugins under `oxlint-plugins/` if a built-in rule proves
insufficient.

---

## Part 2 — SKIP LOCKED claim batch

Land this as its own change, before Part 5. Ordering within it matters — see
"Sequencing" at the end of this part.

### 2a. Fix the `attempt_count` meaning first (live bug)

`claim` (`repository.ts:54`) increments `attempt_count` on every claim, and
`markReady` (line 62) never resets it. The column therefore counts *claims*, not
*failures*. A row that needed three claims to succeed and later loses its
storage object is permanently unclaimable at the default cap of 3. This is
already broken at one instance; Part 2 makes lease-expiry reclaims routine, so
it trips sooner.

- `markReady` also sets `attemptCount: 0`.
- `resetMissingObject` also sets `attemptCount: 0`, `nextAttemptAt: null`
  (this overlaps Part 3 — do it here, once).
- `claim` also clears `nextAttemptAt`. Harmless today, but load-bearing once the
  claim order sorts on that column.

This is a self-contained bug fix with its own regression test; commit it
separately from the rest of Part 2.

### 2b. `claimBatch` in the repository

Extract the claim `.set()` payload into a shared `claimValues(leaseOwner, now)`
so single-key `claim` and the new batch cannot drift, then add:

```ts
async claimBatch(leaseOwner: string, limit: number, now = new Date()): Promise<CardImageRow[]> {
  if (limit <= 0) {
    return [];
  }

  const claimable = this.db
    .select({ imageKey: cardImage.imageKey })
    .from(cardImage)
    .where(claimableCondition(now))
    .orderBy(asc(claimOrder()), asc(cardImage.imageKey))
    .limit(limit)
    .for('update', { skipLocked: true });

  return this.db
    .update(cardImage)
    .set(claimValues(leaseOwner, now))
    .where(inArray(cardImage.imageKey, claimable))
    .returning();
}
```

This is plain query builder — no raw `sql` needed. Verified against the vendored
`drizzle-orm@1.0.0-rc.4`: `.for(strength, { skipLocked })` exists on
`PgSelectBase`, the PG dialect renders it, `inArray` has a typed `SQLWrapper`
overload, and the SQL builder parenthesizes the subquery chunk.

Points to comment in the code rather than rediscover later:
- The existing `claimableCondition` is reused inside the subquery unchanged; the
  subquery's `from(cardImage)` shadows the UPDATE target and drizzle qualifies
  every column, so it resolves correctly with no aliasing.
- Do **not** re-`AND` `claimableCondition` into the outer `WHERE`. It is one
  statement: the subquery takes the row locks and the UPDATE acts on exactly
  those locked rows under one snapshot.
- `.for()` is only legal on the subquery because it selects from a single table
  with no join, group, or distinct.
- A short batch does not mean an empty queue — `LIMIT` is applied before
  `SKIP LOCKED` filtering, so "fewer than requested" means "nothing more for
  me right now".

**Claim order:** `coalesce(next_attempt_at, created_at) ASC, image_key ASC`.
FIFO for fresh work, due-time for retries, one comparable axis, deterministic
tiebreak. `created_at` alone lets a repeatedly-failing row block the head of the
queue; `next_attempt_at NULLS FIRST` starves retries behind any non-empty
backlog.

**Index (optimisation, not correctness):** the existing
`card_image_work_queue_idx` cannot serve the three-way `OR` predicate as a whole.
Add a partial expression index on the claim order where `status <> 'ready'`.
Expect trouble — drizzle-kit rc.4 is unreliable for expression indexes. Run
`just make-migrations`, inspect the SQL, hand-write the `CREATE INDEX` into the
generated file if needed (precedent:
`drizzle/20260905193240_amazing_shotgun/migration.sql:5`), then re-run
`make-migrations` to confirm an empty diff. **If it churns, drop the index
declaration and keep the `ORDER BY`** — the table is small and this is not worth
fighting the generator over.

**One lease owner per batch**, not per row. The fence in `markReady`/`markFailed`
is `(imageKey, leaseOwner)`, so a shared owner cannot cross-contaminate; per-row
owners can't be expressed in one `UPDATE ... RETURNING` anyway. Make it
debuggable as `` `${INSTANCE_ID}:${randomUUID()}` `` with a module-level
`INSTANCE_ID`, and add `lease_owner?: string` to `ImagesLogFields`.

### 2c. Split the materializer

`materialize(imageKey, options)` (proxy: claims internally) and
`materializeClaimed(row, leaseOwner, options)` (worker: row already claimed) both
route through one `singleFlight(imageKey, operation)` helper wrapping the
existing `inFlight` map and `AsyncLimiter`.

There is a real race to handle: the proxy registers in `inFlight` *before* it
claims (the claim runs inside the limiter and can queue), so during that window
a worker `claimBatch` can grab the same row. If `materializeClaimed` silently
joined the proxy's promise, the worker's lease would be stranded, the proxy's own
claim would fail against the worker's owner, and both would return `BUSY` — a 503
for a row nobody is fetching, healing only after the 30s lease. So
`materializeClaimed` checks `inFlight` first and, on a hit, releases its claim
before joining. That needs a new `releaseClaim(imageKey, leaseOwner)` repository
method that reverts to `pending`, nulls the lease, and decrements
`attemptCount` with `greatest(attempt_count - 1, 0)`. Reverting to `pending`
rather than the prior status is a deliberate simplification — worst case a
previously-`failed` row skips its retry delay once; comment it.

While in this file, emit `images.storage.completed` around the `storageClient.put`
block (`materializer.ts:170-195`, currently silent). The event is already declared
in `IMAGES_EVENTS` and never fired; either wire it up or delete the declaration,
because a dead event erodes `docs/logging.md` as a contract.

### 2d. Rewrite the warmer loop

Drop `queuedKeys` entirely. The warmer becomes a cycle that claims at most
`concurrency - activeWorkers` rows per pass, guarded by `cycleRunning` /
`rescanRequested` flags so overlapping wakes collapse into one pass and a wake
arriving mid-`await` is not lost. `enqueue(jobs)` becomes
`notifyRegistered(count)` — once `queuedKeys` is gone the only thing read from
the rows is `.length`, and leaving a `CardImageRow[]` parameter would be a trap.

Two ordering rules that `idle()` depends on; get them wrong and the existing
tests go flaky:
1. `run`'s `finally` decrements `activeWorkers` then calls `cycle()` — it must
   never settle idle resolvers directly. `cycle()` sets `cycleRunning = true`
   synchronously before its first `await`, so the live cycle owns the settle.
2. `rescanRequested` resets at the top of the loop body, before the
   `await claimBatch`.

Also jitter the poll (`setTimeout` reschedule at
`POLL_INTERVAL_MS * (0.5 + Math.random())` instead of a fixed `setInterval`,
keeping the `unref()`), so N instances don't stampede.

`card-pricing/service.ts:356-358` becomes
`notifyRegistered(registered.length)`, keeping the `> 0` guard. Behaviour
improves for free: today a pre-existing `failed` row touched by a search waits a
poll interval, whereas the wake now triggers a `claimBatch` over everything
claimable.

### 2e. Tests

None of the four existing tests in `get-image.integration.test.ts` break
semantically; only the warmer test needs a one-line
`enqueue([row])` → `notifyRegistered(1)` edit. That test is the load-bearing
guard for the `singleFlight` design — if `materializeClaimed` bypassed
`inFlight`, it fails with `callCount === 2`.

New tests:
- **Disjointness:** 10 claimable rows,
  `Promise.all([claimBatch('a', 10), claimBatch('b', 10)])`, assert the key sets
  are disjoint with no duplicates and every returned row is `fetching` with
  `attempt_count = 1`. Do **not** assert a particular split — one call may
  legitimately take all 10. Disjointness is the deterministic invariant.
- **Ordering:** staggered `created_at`/`next_attempt_at`, `claimBatch(owner, 2)`
  returns the two oldest by `coalesce`.
- **Capacity:** warmer at `concurrency: 1` with 3 claimable rows claims exactly 1
  per cycle.
- **Idle:** `warmer.idle()` resolves when nothing is claimable.
- **Regression for 2a:** a row at `attempt_count = MAX_ATTEMPTS` that goes
  through `markReady` is claimable again after `resetMissingObject`.

### Sequencing within Part 2

1. 2a (attempt-count bug fix) + regression test — separate commit.
2. Index + migration, `claimValues`, `claimBatch`, `releaseClaim`, repo tests.
3. Materializer split + `images.storage.completed`.
4. Warmer rewrite, `notifyRegistered`, jitter, `ImagesLogFields` additions.
5. `card-pricing/service.ts` call site + the one-line test edit.

Honest caveat: at one instance the current code is wasteful, not wrong. But the
unbounded `Set` and loss-on-restart are real at N=1 too, and `claimBatch` removes
both.

---

## Part 3 — Fix the `attemptCount` ratchet

Three defects compound in `server/src/card-images/repository.ts`:

1. `resetMissingObject` (line 110) flips `ready` → `pending` when the object has
   vanished from storage but leaves `attemptCount` untouched, so an image that
   already burned `CARD_IMAGE_MAX_ATTEMPTS` can never be re-materialized.
2. The expired-lease branch of `claimableCondition` (line 18) has no
   `attemptCount` bound at all, so a row stuck in `fetching` is reclaimed
   forever — the opposite failure from (1).
3. A row past the attempt cap reports `BUSY` rather than a terminal state
   (`materializer.ts:93-101` → `service.ts:61-64`), so the proxy returns 503
   indefinitely for an image that will never succeed.

Changes:

- **Reset attempts on object loss** — done in Part 2a, which must land first;
  `resetMissingObject` and `markReady` both zero `attemptCount`. Listed here only
  so the retry story reads as one piece.
- **Bound the lease-expiry branch.** Move the `lt(cardImage.attemptCount,
  env.CARD_IMAGE_MAX_ATTEMPTS)` guard so it covers both arms of
  `claimableCondition`, making the attempt cap mean the same thing on every path.
- **Exponential backoff instead of a flat retry.** `markFailed` (line 86)
  currently sets `nextAttemptAt = now + CARD_IMAGE_RETRY_AFTER_MS` flat. Compute
  `now + min(CARD_IMAGE_RETRY_AFTER_MS * 2^(attemptCount - 1),
  CARD_IMAGE_MAX_RETRY_AFTER_MS)` with a new env knob (default ~6h). With
  backoff, raise `CARD_IMAGE_MAX_ATTEMPTS` from 3 to 5 — attempts stop being
  cheap to burn, so a higher cap is affordable.
- **Make exhaustion terminal and honest.** When `markFailed` is called at the
  cap, leave `nextAttemptAt` null (already the non-retryable behaviour) and have
  the materializer distinguish "exhausted" from "busy": in
  `performMaterialization`, when `claim` returns nothing and the fetched row is
  at or past the cap, return `NOT_FOUND` instead of `BUSY` so the proxy answers
  404 rather than 503 forever.

Add an `attempt` field to the `images.warm.completed` / proxy log lines where it
is not already present, per `server/docs/logging.md:125-127` (new fields are
optional members of `ImagesLogFields` in `card-images/logging.ts`).

### Migration

No schema change is required for Part 3 — `attempt_count` and `next_attempt_at`
already exist. Only `CARD_IMAGE_MAX_ATTEMPTS` / the new
`CARD_IMAGE_MAX_RETRY_AFTER_MS` env defaults change.

### Tests

Add repository-level integration tests alongside
`server/src/card-images/tests/get-image.integration.test.ts`:
- a row at the attempt cap is not claimable by either branch, including after
  its lease expires;
- `resetMissingObject` clears the counter and makes the row claimable again;
- `markFailed` backoff grows with `attemptCount` and is capped;
- a proxy request for an exhausted row returns 404, not 503.

---

## Part 4 — Worker topology

The warmer runs on every instance by default
(`CARD_IMAGE_WORKER_ENABLED`, default `true`, `app.ts:169-171`). That is safe —
the lease makes it correct — but two facts are currently undocumented and will
bite on scale-out:

- `CARD_IMAGE_WARM_CONCURRENCY` is **per instance**, so real concurrency against
  the Scrydex CDN is `instances × CARD_IMAGE_WARM_CONCURRENCY`.
- Running the warmer only on a dedicated deployment (web pods with
  `CARD_IMAGE_WORKER_ENABLED=false`) is a supported and often preferable topology.

`CARD_IMAGE_WORKER_ENABLED` **stays `true` by default.** Flipping it to opt-in
would protect a scaled-out deploy from N × concurrency fetches, but at the cost
of an extra required env var in local dev and in any single-instance deploy — and
the lease already makes running it everywhere correct. Making it explicit is a
deployment decision, so it belongs in the docs and the deploy config, not in the
default.

Changes:

- Write `server/docs/card-images.md` covering: the lease protocol and why it is
  safe across instances, the two supported topologies, the per-instance
  concurrency multiplier, required storage configuration, and the retry/backoff
  semantics from Part 3. `server/docs/` currently holds only `logging.md`, and
  `server/README.md` is stale (it still says `npm install` and port 3000) — fix
  the README's commands and link the new doc.
- Expand the `CARD_IMAGE_*` comment block in `.env.example` with the same
  guidance inline.
- Add a startup log line stating whether this instance runs the warmer and at
  what concurrency, so the deployed topology is visible in logs. This needs a new
  event in `IMAGES_EVENTS` (`card-images/logging.ts`) — note
  `images.storage.completed` is already declared but never emitted, which should
  either be wired up in the materializer's storage path
  (`materializer.ts:170-195`, currently silent) or removed.

No code behaviour change beyond the log line; this part is documentation and
observability.

---

## Part 5 — A lever to refresh a bad cached image

### What this is *not*

This is deliberately **not** a fix for "upstream replaced the bytes behind a
stable URL". That risk was considered and accepted in the original plan
(`.agents/plans/quizzical-popping-mist.md`, Risks #4 — "card CDN paths are
versioned in practice"), and that judgement stands. Background revalidation
would permanently double origin traffic to defend against something we have good
reason to think does not happen. `Cache-Control` stays exactly as it is:
`public, max-age=31536000, immutable`. No new columns, no migration, no change to
`CardImageOriginClient`.

### The actual gap

A `ready` row is never re-fetched by anything. That is correct and desirable —
until the stored bytes are wrong, which can happen without the origin ever
changing:

- `origin-client.ts` validates content-type and size but not that the body is a
  decodable image, so an upstream placeholder or error body served as
  `image/png` gets stored and marked `ready`.
- Any future change to our own pipeline (re-encoding, a different thumbnail
  size) leaves every already-cached image on the old bytes.

Today the only remedy is hand-written SQL against production.

### The change

One repository method plus one maintenance script — `server/scripts/` is an
established pattern (`check-openapi-spec.ts`, `download-openapi-spec.ts`, with
`just` recipes at `justfile:65,80,217`). No HTTP endpoint: there is no admin or
role concept in this codebase (`imagesRoute` has no auth middleware at all), so
an endpoint would mean inventing an authorization primitive and a new public
surface solely for this.

```ts
// CardImageRepository
async requeueForRefresh(imageKeys: string[]): Promise<number> {
  const rows = await this.db
    .update(cardImage)
    .set({
      status: CARD_IMAGE_STATUSES.PENDING,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      lastErrorCode: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      storedAt: null,
      updatedAt: new Date(),
    })
    .where(and(inArray(cardImage.imageKey, imageKeys), eq(cardImage.status, CARD_IMAGE_STATUSES.READY)))
    .returning({ imageKey: cardImage.imageKey });

  return rows.length;
}
```

`server/scripts/refresh-card-images.ts` accepts an image key or an origin-URL
`LIKE` pattern, resolves it to keys, calls the method, and prints the count. The
Part 2 warmer picks the rows up on its next cycle — no new machinery.

Add a `just refresh-card-images` recipe and one integration test: a `ready` row
requeued this way is claimable again and re-materializes.

### Known limitation, accepted

The script fixes the database and the bucket, not clients that already cached the
bad image — with `immutable` and a one-year `max-age` those hold it until their
own cache evicts (the Swift app uses `URLCache` at roughly 32 MB memory / 256 MB
disk). Bounding that would require shortening `max-age`, which buys real
revalidation traffic for a case that should be rare. Revisit only if a stale
image is ever actually observed in production, or if images start being ingested
from a source with known-mutable URLs.

---

## Verification

Local development, end to end:

1. `just start-services` — brings up Postgres and MinIO and runs `minio-init`,
   which creates the `tcg-card-images` bucket.
2. `just migrate`.
3. Temporarily unset `OBJECT_STORAGE_ACCESS_KEY_ID` and confirm `just dev-server`
   now refuses to start with the new message, rather than silently using memory.
4. Restore it, `just dev-server`, hit a pricing search endpoint so images get
   registered, then request a proxy URL
   (`/app-api/images/<imageKey>`) twice — first a cold materialize, then a
   `ready` hit with an ETag. Confirm the object appears in the MinIO console at
   `http://localhost:9001` under `card-images/<xx>/<yy>/<key>`.
5. Re-request with `If-None-Match` set to the returned ETag and confirm a 304.
6. `just refresh-card-images <imageKey>`, then request the proxy URL again and
   confirm from the logs that it re-materialized from origin.

Automated:

- `just quality` while iterating (lint/format/typecheck), which will also catch
  any production file still importing from `server/src/tests/**`.
- `just test-server` for the server suite. Note it requires a Docker daemon
  today because `s3-client.integration.test.ts` starts a MinIO testcontainer
  ungated, and it does **not** depend on `start-services` — Postgres must
  already be up.
- `just ready-server` last; do not claim completion until it passes. Only the
  server changes here, so `just ready` is not needed.

Scale check that cannot be automated cheaply: run two `pnpm run dev` processes on
different ports against the same Postgres and MinIO, register a batch of images,
and confirm from the `images.warm.completed` logs that the two instances
partition the work rather than both claiming the same rows.

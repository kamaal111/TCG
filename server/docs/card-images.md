# Card images

Card art is fetched from the pricing provider, cached in our own object storage, and served
from our own domain through an unauthenticated proxy. Clients only ever see our URLs.

## Storage is required

Object storage is the only backend. `App.serve()` refuses to start without
`OBJECT_STORAGE_ACCESS_KEY_ID` and `OBJECT_STORAGE_SECRET_ACCESS_KEY`, so a misconfigured deploy
fails loudly instead of quietly serving nothing.

Locally that storage is the Garage service in `docker-compose.yaml`; `just start-services` brings it up and
creates the bucket, and `.env.example` carries matching settings. `OBJECT_STORAGE_ENDPOINT` is
deliberately optional: Garage needs it; omit it for standard AWS S3 endpoint discovery from the
region, or set it for an S3-compatible service or custom endpoint.

Tests run against real Garage, not a double. `src/tests/global-setup.ts` starts one container for
the whole run and provides its connection details; `createTestObjectStorage` in
`src/tests/storage.ts` gives each test its own bucket in it. So `just test-server` needs a Docker
daemon, and storage integration coverage exercises the same `S3ObjectStorageClient` that production uses — there is
no second storage implementation that can quietly drift from S3 semantics.

## The work queue

`card_image` is the queue. Rows move `pending → fetching → ready`, or to `failed` and back to
`fetching` on retry. There is no in-memory queue, which is what makes the server safe to scale
horizontally:

- **Claiming is an atomic lease.** `CardImageRepository.claim` and `claimBatch` are single
  `UPDATE ... RETURNING` statements guarded by `claimableCondition`. Two instances racing for the
  same row: exactly one wins, the other sees nothing and reports `busy`.
- **Batch claims partition the queue.** `claimBatch` selects `FOR UPDATE SKIP LOCKED`, so N
  instances take disjoint work instead of racing over the same rows.
- **Completions are fenced.** `markReady` and `markFailed` require the caller's `leaseOwner`, so a
  worker whose lease expired mid-fetch cannot overwrite whoever took over.
- **Abandoned work can be reclaimed.** `claimableCondition` reclaims `fetching` rows whose
  `leaseExpiresAt` has passed while their attempt count remains below the configured cap.
  The default lease duration is 30 seconds (`CARD_IMAGE_LEASE_DURATION_MS`). See the final-attempt
  limitation below.
- **Serving is stateless.** The proxy reads the row from Postgres and the bytes from object
  storage, and answers `If-None-Match` from the stored checksum. Any instance can serve any image.

Nothing is lost on restart, because nothing was ever only in memory.

## Attempts and retries

`attempt_count` counts claims since the last successful materialization or reset. Both `claim`
and `claimBatch` increment it before fetching; failed or abandoned claims consume the budget.
`markReady` resets it to zero, and `releaseClaim` refunds a claim when work joins an existing
in-process fetch. `resetMissingObject` also clears it, so a missing stored object starts over.

Retries back off exponentially — `CARD_IMAGE_RETRY_AFTER_MS` doubled per attempt, capped at
`CARD_IMAGE_MAX_RETRY_AFTER_MS`. After `CARD_IMAGE_MAX_ATTEMPTS` the image is out of attempts and
is no longer claimable on any path, including lease recovery. A subsequent proxy request for an
exhausted row outside `fetching` answers **404**. The request that encounters the final retryable
failure can still answer 503. Non-retryable failures have no scheduled retry.
The request that encounters a non-retryable origin failure answers 404, but later
requests for that failed row below the attempt cap currently answer 503 because
the materializer treats the unclaimable row as busy.

**Final-attempt limitation:** if a process dies while a row is `fetching` at the attempt cap,
the expired lease cannot be reclaimed. The materializer also excludes `fetching` rows from its
exhausted check, so proxy requests continue returning 503. This state requires database repair;
`refresh-card-images` only resets `ready` rows and does not recover it.

## Worker topology

`CARD_IMAGE_WORKER_ENABLED` defaults to `true`, so every instance warms images. The lease makes
that correct, and it keeps local development and single-instance deploys simple. On startup each
instance logs `images.warm.started` with its `warm_concurrency`, so the deployed topology is
visible in logs.

**`CARD_IMAGE_WARM_CONCURRENCY` is per instance.** The materializer uses this limit for both
worker and foreground proxy fetches. Disabling the warmer does not disable foreground fetching,
so web instances can still contact the origin CDN. Two supported worker shapes:

| Topology                  | Setting                                                   | Notes                                                                                                 |
| ------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Warm everywhere (default) | `CARD_IMAGE_WORKER_ENABLED=true` everywhere               | Each instance scans the queue; total possible materialization concurrency scales with instance count. |
| Dedicated worker          | `false` on web instances, `true` on one worker deployment | Background warming stays on the worker; cold proxy requests can still fetch on web instances.         |

Polling is jittered (half to one and a half times `CARD_IMAGE_WORKER_POLL_INTERVAL_MS`) so
instances do not poll in lockstep.

## Refreshing a stored image

A `ready` image with an existing stored object is not re-fetched automatically. If the object is
missing, the proxy resets the row and materializes it again. Image keys are a hash of the origin URL.
The cache policy assumes the bytes for a given origin URL remain stable; persisted responses use
`Cache-Control: public, max-age=31536000, immutable` on that basis.

If the origin fetch succeeds but storage fails, the proxy can still return the bytes with
`Cache-Control: no-store`; the row is marked failed. Retry scheduling follows whether that
storage error is retryable. Failed reads of existing storage return 503; conditional responses
can return 304 from database metadata without reading the object.

The case that assumption does not cover is bytes that were wrong when we stored them — an origin
placeholder cached as card art, or a change to how we fetch or store images. For that:

```sh
just refresh-card-images <imageKey>
just refresh-card-images 'https://images.scrydex.com/%'
```

This flips matching `ready` rows back to `pending` and clears their attempt budget; the warmer
picks them up on its next cycle. Note it fixes the database and the bucket, not clients that
already cached the bad image — those hold it until their own cache evicts.
Origin patterns use SQL `LIKE` syntax (`%` and `_` wildcards), and each pattern lookup is limited
by `CARD_IMAGE_ORIGIN_URL_PATTERN_LIMIT` (default 1000 rows).

Revisit the immutable assumption only if a stale image is actually observed in production, or if
images start being ingested from a source with known-mutable URLs.

## Logging

Events are declared in `src/card-images/logging.ts` and enforced by the type checker; see
[logging.md](./logging.md) before adding a log line. The warmer is not request-scoped, so it uses
`processImagesLogger()` rather than `imagesLogger(c)`.

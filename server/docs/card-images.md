# Card images

Card art is fetched from the pricing provider once, stored in our own object storage, and served
from our own domain through an unauthenticated proxy. Clients only ever see our URLs.

## Storage is required

Object storage is the only backend. `App.serve()` refuses to start without
`OBJECT_STORAGE_ACCESS_KEY_ID` and `OBJECT_STORAGE_SECRET_ACCESS_KEY`, so a misconfigured deploy
fails loudly instead of quietly serving nothing.

Locally that storage is the Garage service in `docker-compose.yaml`; `just start-services` brings it up and
creates the bucket, and `.env.example` carries matching settings. `OBJECT_STORAGE_ENDPOINT` is
deliberately optional: Garage needs it, real S3 must not have it so the SDK can derive the endpoint
from the region.

Tests run against real Garage, not a double. `src/tests/global-setup.ts` starts one container for
the whole run and provides its connection details; `createTestObjectStorage` in
`src/tests/storage.ts` gives each test its own bucket in it. So `just test-server` needs a Docker
daemon, and every test exercises the same `S3ObjectStorageClient` that production uses — there is
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
- **Abandoned work recovers itself.** `claimableCondition` reclaims `fetching` rows whose
  `leaseExpiresAt` has passed, so a pod that dies mid-fetch costs one lease duration
  (`CARD_IMAGE_LEASE_DURATION_MS`, 30s), not a stuck image.
- **Serving is stateless.** The proxy reads the row from Postgres and the bytes from object
  storage, and answers `If-None-Match` from the stored checksum. Any instance can serve any image.

Nothing is lost on restart, because nothing was ever only in memory.

## Attempts and retries

`attempt_count` counts _failures_, not claims: `claim` increments it and `markReady` resets it to
zero. `resetMissingObject` also clears it, so an image whose stored object disappears starts over
rather than inheriting an old failure budget.

Retries back off exponentially — `CARD_IMAGE_RETRY_AFTER_MS` doubled per attempt, capped at
`CARD_IMAGE_MAX_RETRY_AFTER_MS`. After `CARD_IMAGE_MAX_ATTEMPTS` the image is out of attempts and
is no longer claimable on any path, including lease recovery. The proxy then answers **404**, not
503: the image is not coming, and telling clients to keep retrying would be a lie.

## Worker topology

`CARD_IMAGE_WORKER_ENABLED` defaults to `true`, so every instance warms images. The lease makes
that correct, and it keeps local development and single-instance deploys simple. On startup each
instance logs `images.warm.started` with its `warm_concurrency`, so the deployed topology is
visible in logs.

**`CARD_IMAGE_WARM_CONCURRENCY` is per instance.** Real concurrency against the origin CDN is that
value multiplied by the number of instances running the warmer. Two supported shapes:

| Topology                  | Setting                                                   | Notes                                                                                               |
| ------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Warm everywhere (default) | `CARD_IMAGE_WORKER_ENABLED=true` everywhere               | Simplest. Divide `CARD_IMAGE_WARM_CONCURRENCY` by the instance count to hold origin load flat.      |
| Dedicated worker          | `false` on web instances, `true` on one worker deployment | Origin load is independent of how far the web tier scales. Preferable once the web tier autoscales. |

Polling is jittered (half to one and a half times `CARD_IMAGE_WORKER_POLL_INTERVAL_MS`) so
instances do not poll in lockstep.

## Refreshing a stored image

A `ready` image is never re-fetched. That is deliberate: image keys are a hash of the origin URL,
and provider CDN paths are versioned in practice, so re-checking origin would be pure waste.
Responses are served `public, max-age=1y, immutable` on that basis.

The case that assumption does not cover is bytes that were wrong when we stored them — an origin
placeholder cached as card art, or a change to how we fetch or store images. For that:

```sh
just refresh-card-images <imageKey>
just refresh-card-images 'https://images.scrydex.com/%'
```

This flips matching `ready` rows back to `pending` and clears their attempt budget; the warmer
picks them up on its next cycle. Note it fixes the database and the bucket, not clients that
already cached the bad image — those hold it until their own cache evicts.

Revisit the immutable assumption only if a stale image is actually observed in production, or if
images start being ingested from a source with known-mutable URLs.

## Logging

Events are declared in `src/card-images/logging.ts` and enforced by the type checker; see
[logging.md](./logging.md) before adding a log line. The warmer is not request-scoped, so it uses
`processImagesLogger()` rather than `imagesLogger(c)`.

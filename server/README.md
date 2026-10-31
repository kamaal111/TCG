# TCG server

[Back to project README](../README.md)

The TypeScript API uses Hono and Zod/OpenAPI route contracts, PostgreSQL with
Drizzle, Better Auth for email/password sessions and JWTs, Scrydex pricing, and
S3-compatible storage for card images. The default pricing client serves sample
data; live Scrydex requires explicit configuration.

Run every recipe from the repository root.

```sh
cp .env.example .env   # first time only
just prepare
pnpm exec auth secret  # put the generated value in .env as BETTER_AUTH_SECRET
just dev-server
```

```sh
open http://localhost:8080/doc
```

The server refuses to start without object storage credentials — see
[Card images](docs/card-images.md) if that is what stopped you.
`just dev-server` starts PostgreSQL and Garage, initializes storage, and applies
migrations and checks daily exchange-rate collection before running in watch mode.
Use `just stop-services` when finished
with the sidecars. `GET /health/ping` is a public liveness endpoint.

## Verification

```sh
just quality-server    # lint, format, typecheck, OpenAPI spec
just test-server       # needs a Docker daemon; tests start their own Postgres and Garage
just ready-server      # quality, server tests, and image smoke test
just build-server-image # build the production image as tcg-server:local
just test-server-image  # build and smoke test the image; needs a Docker daemon
```

The image starts the HTTP server on port 8080. Supply `DATABASE_URL`, `BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET`, and the object storage credentials at runtime; see `.env.example` for
the remaining settings. Run `just migrate` separately before deploying a version that needs
new database migrations. The image does not run migrations on startup.

## Documentation

- [Development](../docs/development.md) — tools, environment settings, migrations, verification, and CI.
- [Architecture](../docs/architecture.md) — domain boundaries, persistent data, and request flow.
- [API](docs/api.md) — routes, auth headers, owned-card payloads, pricing semantics, and errors.
- [Logging](docs/logging.md) — how structured logging works here, the field vocabulary, and how to add an event.
- [Card images](docs/card-images.md) — the image cache, its work queue, and how it behaves across instances.

## Daily currency rates

`just dev-server` runs `just fetch-daily-currencies` after migrations, before
starting the HTTP server. On a fresh database this supplies the initial rates.
Restarts skip fetching when collection already succeeded on the same UTC day.
This is a startup check, not a background timer; a server left running does not
schedule collection by itself.

For other environments, run `just migrate`, then `just fetch-daily-currencies`
from the repository root before using conversions. Schedule the latter once daily
after 16:00 Europe/Frankfurt.
It fetches the ECB daily XML feed and persists a validated EUR-based snapshot.
Repeated or concurrent runs do not duplicate snapshots. Weekends and holidays
retain the last published rates; collection errors preserve stored data and exit
unsuccessfully. The script closes its database pool before exiting.
The daily check uses the successful collection time, not the ECB publication
date. A valid fetch with an unchanged publication date updates the collection
time without replacing that snapshot's rates. Failed collection does not mark
the day complete, so another invocation can retry.

`GET /app-api/forex/latest` requires authentication and returns `{base, date, rates}`.

Without collected rates it returns HTTP 503 with `EXCHANGE_RATES_UNAVAILABLE`;
card endpoints continue working. Market prices and purchase records retain their
source currencies. The server supplies preferred-currency `display` projections on priced cards
and `display_price` on purchases, using the latest available snapshot rather
than historical purchase-date rates. Source fields and shared provider caches
remain unchanged. Responses identify unavailable conversions and retain source
amounts for those cases. Each authenticated request resolves the current saved
preference, including requests that reuse cached market prices.

`POST /app-api/auth/preferences` accepts `preferred_currency` and initializes it
only when the authenticated account has no saved preference. Repeated or delayed
initialization returns the saved preference without overwriting it.
`PATCH /app-api/auth/preferences` accepts the same currency payload and saves an
explicit Settings choice to the authenticated account. Session responses include
the resolved currency. Accounts without a saved preference use
`DEFAULT_PREFERRED_CURRENCY` from `.env` (USD when unset). It must be a supported
ECB currency code. The app can then initialize their supported device-region
currency.

### Schedule collection on a macOS home server

Use a dedicated, persistent checkout with dependencies installed (`just prepare-server`)
and secure access to the intended PostgreSQL database, for example through a VPN.
Keep PostgreSQL closed to the public internet. The scheduler does not create or
maintain that connection or run migrations.

Create a private environment file outside the repository, for example
`$HOME/.config/tcg/currencies.env`, containing:

```dotenv
DATABASE_URL=postgresql://tcg:replace-with-production-password@private-db-host/tcg
```

Only `DATABASE_URL` is required for collection; `BETTER_AUTH_URL` is not used.
Optional settings are `DATABASE_CONNECTION_TIMEOUT_MS`, `LOG_LEVEL`, `MODE`, and `DEBUG`.
Set its permissions with `chmod 600 "$HOME/.config/tcg/currencies.env"`.
Omit `DEBUG`: the current boolean parser treats even `DEBUG=false` as enabled,
and the installer rejects it. These settings are loaded directly from this file;
the checkout's `.env` and interactive shell environment are not used by the job.
The plist contains the environment-file path, not its contents.

Run the following from the checkout root as your regular user, without prefixing
`just` with `sudo`. Installation and removal request administrator access for the
system operations only:

```sh
# Preview the plist without installing or fetching anything.
bash scripts/currency-schedule.sh preview "$HOME/.config/tcg/currencies.env"
just install-currency-schedule "$HOME/.config/tcg/currencies.env"
just currency-schedule-status
just uninstall-currency-schedule
```

Installation creates `/Library/LaunchDaemons/com.tcg.daily-currencies.plist` and
schedules collection at **17:15 Mac local time**, running as your regular user.
Set the Mac's system timezone to Europe/Amsterdam or Europe/Berlin; the installer
requires one of these so the time remains after Frankfurt's publication window
across daylight saving changes. Keep that timezone setting after installation.
Reinstalling updates the same job rather than adding another. Installation does
not fetch rates immediately. For an initial collection after the publication window,
run the existing collector explicitly with the same environment file:

```sh
cd server
env -i HOME="$HOME" NODE_ENV=production "$(command -v node)" \
  --env-file="$HOME/.config/tcg/currencies.env" scripts/fetch-daily-currencies.ts
```

The job continues after SSH disconnects and desktop logout. It needs the Mac
awake, network access, and an accessible home directory; FileVault may require
the first login after a reboot. A calendar trigger missed during sleep runs on
wake; the scheduled wrapper skips runs before 17:15 Frankfurt time so a morning
wake-up does not suppress that afternoon’s collection. A powered-off machine
cannot collect rates. Avoid manually collecting
before publication: a successful run makes the collector skip further runs on
the same UTC day, even if the earlier fetch received yesterday's rates.

Inspect `just currency-schedule-status` for launchd state and the last exit code.
Collection outcomes are appended to `~/Library/Logs/TCG/currencies.stdout.log`;
runtime errors go to `currencies.stderr.log` in that directory. Monitor these logs
and arrange log rotation as needed. Failed collection preserves existing rates;
there is no automatic retry before the next daily trigger. Removing the job
preserves its logs and environment file.

The plist pins this checkout and the current absolute Node executable. Keep both
available, including dependencies and scripts; rerun installation after moving
the checkout or replacing/removing that Node version. Do not install from a
temporary feature worktree that will later be deleted.

## Database connections

`DATABASE_CONNECTION_TIMEOUT_MS` defaults to 2,000 ms and bounds both new
connections and waits for an available pooled connection. The PostgreSQL driver
removes expired waiters from its queue. Query and transaction deadlines remain
separate settings.

## Collection processing limits

Collection request budgets are configurable through these environment variables:

| Variable                          |   Default |
| --------------------------------- | --------: |
| `COLLECTION_MAX_BODY_BYTES`       | 8,388,608 |
| `COLLECTION_MAX_COLLECTIONS`      |       500 |
| `COLLECTION_MAX_CARDS`            |     5,000 |
| `COLLECTION_MAX_PAGES`            |     2,000 |
| `COLLECTION_MAX_SLOTS`            |    25,000 |
| `COLLECTION_MAX_PURCHASES`        |    25,000 |
| `COLLECTION_BODY_TIMEOUT_MS`      |    30,000 |
| `COLLECTION_OPERATION_TIMEOUT_MS` |   120,000 |
| `COLLECTION_STATEMENT_TIMEOUT_MS` |    10,000 |
| `COLLECTION_LOCK_TIMEOUT_MS`      |     2,000 |
| `COLLECTION_CONCURRENCY`          |         4 |

Binder dimensions must each be between 1 and 20, allowing at most 400 slots
per page. Rectangular layouts such as 1 by 4 are supported.
Adding a card or moving it to another collection places all its copies in the
first empty slot, scanning pages in order and slots row by row. A new page is
created when necessary, up to `COLLECTION_MAX_PAGES`. If the binder is full at
that limit, the card change is rejected without saving partial data. Existing
gaps are preserved when editing a card in its current collection, and backup
imports retain their explicit layouts.

Counts apply to submitted data, including empty pages, across the entire request.
The collection count also limits explicit export IDs. Export all collections by
omitting `collection_ids`; full exports have no count or output-size cap. They are
streamed in bounded batches and remain subject to the operation deadline.
The stream sends its prefix immediately, then combines small fragments into
64 KiB buffers while preserving backpressure and cancellation.
An exported backup can exceed the import budgets; increase the importing server's
limits to restore it. Keep policy settings consistent across replicas sharing a database.

Layout saves, previews, imports, and exports share one PostgreSQL-backed operation
permit per account and four deployment-wide permits by default. Busy requests
return 429 (account) or 503 (deployment) with `Retry-After: 1`. Request budget
violations return 413, slow uploads return 408, and database deadlines return 503.
Database timeouts apply locally to collection transactions and PostgreSQL releases
permits on commit, rollback, or connection termination. Use PostgreSQL 18 or newer
for the transaction deadline. Interrupted exports terminate the response stream;
clients must reject incomplete JSON rather than save a partial backup.

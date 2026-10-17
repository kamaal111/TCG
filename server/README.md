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

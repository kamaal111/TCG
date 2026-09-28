# API guide

[Back to README](../../README.md) · [Server guide](../README.md)

The Hono API is mounted under `/app-api`. Routes and Zod schemas in `server/src/`
define the contract. The generated [OpenAPI YAML](../../app/Modules/TCGClient/Sources/TCGClient/openapi.yaml)
contains exact request/response schemas and status codes. With a local server
running, browse `http://localhost:8080/doc`, `/spec.json`, or `/spec.yaml`.

## Routes

| Method | Path                          | Purpose                                                      |
| ------ | ----------------------------- | ------------------------------------------------------------ |
| GET    | `/health/ping`                | Public liveness response `{"message":"PONG"}`                |
| POST   | `/app-api/auth/sign-up/email` | Create an email/password account                             |
| POST   | `/app-api/auth/sign-in/email` | Sign in and receive credentials                              |
| POST   | `/app-api/auth/sign-out`      | Invalidate the current session                               |
| GET    | `/app-api/auth/session`       | Retrieve session/user information                            |
| GET    | `/app-api/auth/token`         | Issue an API JWT using a session token                       |
| GET    | `/app-api/cards`              | List owned cards, optionally filtered by `game`, with prices |
| POST   | `/app-api/cards`              | Create an owned card; returns 201 with card and price        |
| PUT    | `/app-api/cards/{cardId}`     | Fully replace an owned card's editable fields and quantities |
| DELETE | `/app-api/cards/{cardId}`     | Delete an owned card; returns 204                            |
| GET    | `/app-api/pricing/search`     | Search by required `game` and `query`; returns `matches`     |
| GET    | `/app-api/images/{imageKey}`  | Public card image proxy; supports conditional requests       |

Collection and pricing routes require authentication. Collection reads/writes are
scoped to the authenticated user. Missing and other users' cards both return
404 with `CARD_NOT_FOUND`. Image URLs are public so image loading does not need
the app's auth middleware.

## Authentication

Email/password authentication is implemented with Better Auth and the Kamaal
Hono auth module. Email verification is not required by the current configuration.
Sign-up accepts `name`, `email`, and `password`; sign-in accepts `email` and
`password`. Successful sign-up/sign-in responses include:

| Header                   | Meaning                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `set-auth-token`         | JWT for normal authenticated API requests                      |
| `set-auth-token-expiry`  | JWT lifetime in seconds, encoded as a string                   |
| `set-session-token`      | Session credential used to issue fresh JWTs                    |
| `set-session-update-age` | Interval in seconds after which the session should be verified |

Send `Authorization: Bearer <JWT>` for normal native-client requests. To refresh,
call `GET /app-api/auth/token` with `Authorization: Bearer <session-token>`;
that endpoint requires the session credential and rejects the issued JWT. It
returns a token body and updated credential headers. The default session lifetime
is 30 days, session update age one day, and JWT lifetime seven days.

The Swift client delegates storage, refresh, and sign-out behavior to KamaalAuth
through `TCGAuthRequestHooks`, `AuthTokenIssuer`, and authorization middleware.
Use those existing adapters when adding native-client operations.

## Owned-card contract

Games use `pokemon` and `one_piece`. Conditions are `mint`, `near_mint`,
`excellent`, `good`, `played`, and `damaged`. Create and update share this payload:

```json
{
  "game": "one_piece",
  "name": "Monkey D. Luffy",
  "set_name": "Romance Dawn",
  "card_number": "OP01-003",
  "notes": "Alternate art",
  "quantities": [
    { "condition": "near_mint", "quantity": 2 },
    { "condition": "played", "quantity": 1 }
  ]
}
```

`name` and `set_name` are required, with lengths 1–200; `card_number` is 1–50.
Optional notes are trimmed, limited to 2000 characters, and cleared when omitted
or blank on replacement. `quantities` must contain at least one condition,
without duplicates, each with an integer quantity from 1 to 999. A `PUT` replaces
the full editable payload and quantity set. Card path IDs must be UUIDs.

Responses include a generated ID, identifying fields, notes, condition quantities,
timestamps, and a `price` object. Quantities are serialized in the condition order
listed above. List responses wrap entries in `{"cards":[...]}` and sort newest
entries first; `?game=pokemon` or `?game=one_piece` filters them. There is currently
no pagination parameter.

## Pricing behavior

`GET /app-api/pricing/search?game=pokemon&query=Charizard` returns
`{"matches":[...]}`. Queries are trimmed and must be 2–200 characters. Each
priced match includes a stable local UUID, game, name, card number, pricing date,
fetch timestamp, and optional rarity, proxy image URL, headline, and market data.
The priced-card UUID is separate from an owned-card UUID.

The default `SCRYDEX_CLIENT=static` uses sample data and synthetic fallback search
results. Set `SCRYDEX_CLIENT=real`, `SCRYDEX_API_KEY`, and `SCRYDEX_TEAM_ID` to use
live Scrydex. Caches include provider source in their keys, so static and live
results are separate. Search and per-card prices are cached per UTC day;
PostgreSQL advisory locks coordinate concurrent misses.

Normalization selects a supported base variant and raw Near Mint price. The
headline is the lowest Near Mint amount (`metric: "lowest_near_mint"`), with
optional market average and 7/30-day movements. Prices are not adjusted for the
condition or quantity of the user's owned copies, and do not select an alternate
art variant from free-form notes.

Owned-card pricing reports one of these statuses:

| Status        | Meaning                                                 |
| ------------- | ------------------------------------------------------- |
| `priced`      | A matching priced card has normalized market data       |
| `no_match`    | No provider card could be matched                       |
| `no_price`    | A card matched but has no usable normalized market data |
| `unavailable` | A collection-list item's pricing lock timed out         |

The service reuses a saved provider identity when available; otherwise it searches
using name and card number, preferring number matches before name matches. This
matching is heuristic. `priced_card` is optional, and `priced` does not guarantee
every amount or trend field is present.

Collection listing tolerates individual lock timeouts as `unavailable`, but a
pricing-provider failure can still fail the request. Create/update persist the
card before pricing the response: a subsequent pricing error can return 503 even
though the card was saved. Re-list the collection before blindly retrying a failed
create, to avoid adding a duplicate entry.

## Images and errors

The pricing service registers image origins and returns the server's proxy URLs,
using `PUBLIC_BASE_URL` or `BETTER_AUTH_URL`. The image proxy serves cached bytes
with ETags and immutable cache headers, or materializes pending images. Temporary
busy/retry states can return 503 with `Retry-After`; missing or exhausted images
return 404. See [card images](card-images.md) for the full state machine and refresh
procedure.

API errors use JSON with `message` and a machine-readable `code`. Validation
failures use `INVALID_PAYLOAD` and may include field issues:

```json
{
  "message": "Invalid payload",
  "code": "INVALID_PAYLOAD",
  "context": {
    "validations": [{ "code": "too_small", "path": ["name"], "message": "..." }]
  }
}
```

Common statuses are 400 for validation, 401 for authentication, 404 for missing
resources, and 503 for temporary pricing/image unavailability. Pricing 503 codes
include `PRICING_LOCK_TIMEOUT` and `PRICING_PROVIDER_UNAVAILABLE`; both provide
`Retry-After`. Unexpected errors return 500 with `INTERNAL_SERVER_ERROR`.

The request-ID middleware uses `tcg-request-id`; server-defined API exceptions
also include `Request-Id` in their responses. Use request IDs to correlate events
in [structured logs](logging.md), keeping credentials and user search text out
of logs.

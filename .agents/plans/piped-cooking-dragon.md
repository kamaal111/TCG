# Fix the daily sign-out: refresh with the session token, and make session logs diagnosable

## Context

The app signs the user out roughly once a day. The server is behaving correctly; the client
authenticates the token-refresh call with the wrong credential.

`GET /app-api/auth/token` is forwarded verbatim to better-auth (`server/src/auth/handlers/token.ts:21-25`),
so it only accepts the **session token** as its bearer credential. It also echoes that same value back
as the `set-session-token` response header (`handlers/token.ts:27-29`). The app instead attaches the
**JWT** to every outgoing request, including this one (`SessionAuthorizationMiddleware.swift:73`), so the
refresh can never succeed.

Why it presents as daily, from the reported keychain entry:

| field               | value        | unix       | meaning                               |
| ------------------- | ------------ | ---------- | ------------------------------------- |
| `lastSessionUpdate` | 806442713.28 | 1784749913 | identical to the JWT `iat`            |
| `expiryDate`        | 807047513    | 1785354713 | identical to the JWT `exp` (iat + 7d) |
| `sessionUpdateAge`  | 86400        |            | 1 day                                 |

`SessionAuthorizationMiddleware.swift:35` refreshes when `shouldUpdateSession || willExpireSoon()`.
`willExpireSoon()` defaults to a 1-hour window (`TCGUtils/Sources/TCGUtils/Expirable.swift:22`), so what
fires is `shouldUpdateSession` — one day after sign-in, with six days of JWT left. `lastSessionUpdate`
being byte-identical to the JWT `iat` proves that entry was never once refreshed after sign-in: every
daily attempt failed. `TCGAuth.getCachedSessionIfLoadedToday` (`TCGAuth.swift:167-177`) only reuses a
cached session on the same calendar day, so the next day the app is forced onto the network and into the
broken refresh.

The user is not actually un-credentialed. A 404 lands in `.undocumented` → `.unknown`
(`TokenRefresher.swift:37-38`); only a 401 deletes. The keychain entry survives, `loadSession` fails with
`.serverUnavailable`, `session` stays nil, and the sign-in screen appears.

Two failing tests already reproduce this on `gitbutler/workspace`, in
`app/Modules/TCGClient/Tests/TCGClientTests/TCGSessionRefreshRegressionTests.swift`. **That file gets
deleted as part of this work** — its two cases move into `TCGAuthClientTests.swift`. Every test protects
against regressions; a suite named "regression" is not a special class of test.

Server env for reference (`server/src/env.ts:22-25`): session 30 days, session update age 1 day, JWT
7 days. The intended design is a short-lived JWT for API calls and a long-lived session token for
refresh. Today the app stores the session token and never sends it anywhere.

Intended outcome: the app stays signed in for the full 30-day session life, a genuinely dead session
produces a clean sign-in prompt rather than "server unavailable", and the next person debugging a session
problem can tell from the logs alone which credential was presented and why a refresh happened.

---

## Part A — Refresh with the session token

**`app/Modules/TCGClient/Sources/TCGClient/SessionTokenAuthorizationMiddleware.swift`** (new)

A `ClientMiddleware` that reads credentials via the existing
`CredentialsStore.credentials(forKey:)` extension (`CredentialsStore.swift:33-39`) and sets
`Bearer <credentials.sessionToken>`. No expiry checks, no refresh, no recursion. If there are no
credentials, pass the request through unauthenticated, matching `SessionAuthorizationMiddleware.swift:25-27`.

**`app/Modules/TCGClient/Sources/TCGClient/TCGClient.swift:147-158`**

Build `tokenClient` with the new middleware instead of `SessionAuthorizationMiddleware(… tokenRefresher: nil)`.

**`app/Modules/TCGClient/Sources/TCGClient/SessionAuthorizationMiddleware.swift`**

Make `tokenRefresher` non-optional and delete the `guard let tokenRefresher else` fallback at lines 36-44.
That `nil` was the bug's hiding place: it meant "you are the token client, do not recurse", but implemented
it by silently falling through to the JWT path. With the type non-optional the wrong credential can no
longer be expressed.

> When a sign-out endpoint is eventually added it must use the session-token client too —
> `handlers/sign-out.ts:20` forwards to better-auth the same way, and a JWT bearer there returns 200 while
> leaving the session row alive. The app has no sign-out today; do not add one in this change.

## Part B — Split the two expiry lifetimes

`Credentials.expiryDate` currently means two different things depending on which call wrote it last:
`TokenRefresher.swift:68-69` writes the **JWT** expiry, `TCGAuthClient.swift:73` overwrites it with the
**session** expiry via `setExpiryDate`. So `hasExpired`/`willExpireSoon()` answer whichever question was
asked most recently.

**`app/Modules/TCGClient/Sources/TCGClient/Credentials.swift`**

- Rename `expiryDate` → `authTokenExpiryDate`. Add `sessionExpiryDate: Date?` (nil = not yet known).
- Drop the `Expirable` conformance and the `expiresAt` property. Replace with explicitly named members so
  every call site states which lifetime it means:
  - `authTokenHasExpired`
  - `authTokenWillExpireSoon(within: TimeInterval = 3600)`
  - `sessionHasExpired` — `false` when `sessionExpiryDate` is nil; the server is the authority, so an
    unknown session is treated as live and allowed to be tested against the network.
  - keep `shouldUpdateSession` as-is.
    Leave `Expirable` itself untouched — `UserSession` still uses it (`TCGAuth.swift:168`).
- Rename `setExpiryDate(_:)` → `settingSessionExpiryDate(_:)`, writing `sessionExpiryDate`.
- Delete `updatedSession()` (`Credentials.swift:50-58`) — it is dead code.
- Add a custom `init(from decoder:)` that falls back to a legacy `expiryDate` key when
  `authTokenExpiryDate` is absent, and tolerates a missing `sessionExpiryDate`. Without this every existing
  user is force-signed-out on upgrade. A legacy value may hold either lifetime because of the bug above;
  reading it as the auth-token expiry at worst triggers one early refresh, which now works.

**`app/Modules/TCGClient/Sources/TCGClient/TokenRefresher.swift:59-86`**

`storeCredentials` must carry `sessionExpiryDate` forward from the currently stored credentials instead of
dropping it — otherwise every refresh erases what `session()` learned.

**`app/Modules/TCGClient/Sources/TCGClient/SessionAuthorizationMiddleware.swift:29-33`**

Stop deleting credentials when the JWT expires. An expired or expiring JWT is exactly the case the
30-day session token exists to solve, so it must trigger a refresh, not a wipe. Delete credentials only
when `sessionHasExpired` is provably true, or when the server rejects the refresh (Part C). Concretely
the branch becomes: `sessionHasExpired` → delete and continue unauthenticated; otherwise
`shouldUpdateSession || authTokenWillExpireSoon()` → refresh; otherwise attach the JWT.

**`app/Modules/TCGClient/Sources/TCGClient/TCGClient.swift:34-39`**

`hasValidCredentials` currently returns `!credentials.hasExpired`, i.e. "the JWT is alive" — which makes
`TCGAuth.swift:30` skip the session load entirely after 7 idle days. Base it on `!sessionHasExpired` so
the app asks the server instead of assuming.

**`app/Modules/TCGClient/Sources/TCGClient/TCGAuthClient.swift:73`**

Use `settingSessionExpiryDate(responsePayload.session.expiresAt)`. This is where `sessionExpiryDate` gets
populated — `/app-api/auth/session` returns the real session expiry, and the app calls it on every launch
and after every auth success, so in practice it is known.

**`app/Modules/TCGClient/Sources/TCGClient/TCGClient.swift:101-107`** — the preview credential seed needs
the new fields (`sessionExpiryDate: .distantFuture`).

## Part C — Make a dead session surface as "sign in", not "server unavailable"

Two separate defects make a genuine session expiry unreadable to the user.

**1. The 404 is undocumented.** `server/src/auth/routes/token.ts:22-36` declares 200 and 401, but the
handler throws `SessionNotFound` (404). The generated Swift client therefore has no `.notFound` case and
the app gets `.undocumented(404)` → `.unknown`. Add a 404 response to the route using the existing
`ErrorResponseSchema`, mirroring `routes/session.ts`. Then run `just download-spec` (regenerates
`app/Modules/TCGClient/Sources/TCGClient/openapi.yaml`; `just check-spec` enforces it in `quality`) and
handle the new `.notFound` case in `TokenRefresher.refreshToken` (`TokenRefresher.swift:34-41`) the same
way `.unauthorized` is handled — `deleteCredentials(then: .unauthorized)`.

**2. `SessionErrors.unauthorized` is flattened on the way out of the middleware.** When
`SessionAuthorizationMiddleware.swift:46` rethrows, OpenAPIRuntime wraps it in a `ClientError`, so
`TCGAuthClient.swift:52-53` catches an opaque error and returns `.unknown(status: 503)`. That is why a
dead session reads as "The server is unavailable." In the `catch` blocks of `session()` (and
`refreshToken`), unwrap `ClientError.underlyingError as? SessionErrors` and propagate it unchanged.
The existing test at `TCGAuthClientTests.swift:509-526` documents the current flattening — it will need
updating.

## Part D — Session logging

The reported incident produced one server line with `error_code: "SESSION_NOT_FOUND"` and no other
detail, and two app lines with no error context at all. Neither side recorded **which credential was
presented** — the single fact that identifies this bug instantly.

### Server (`component: 'auth'`, via `withRequestLogger(c, { component: 'auth' })`)

Follow the house conventions exactly: dot-namespaced `event` first, `outcome: 'success' | 'failure'` on
terminal events, `error_code` on failures, scalars only (`sanitizeLogRecord` in `src/logging/index.ts:205`
silently drops objects). **Never log token material** — log shape, not value, the way
`card-pricing/repository.ts:186-201` logs `lock_key_type` but not `lock_key`.

- **New helper, `src/auth/utils/credentials.ts`**: classify the inbound credential without touching its
  value → `credential_kind: 'bearer_jwt' | 'bearer_opaque' | 'cookie' | 'none'`. A bearer with three
  dot-separated segments is a JWT; anything else opaque. This one field makes the bug self-evident in the
  logs. Reuse it everywhere below.
- **`src/auth/middleware.ts:107-111`** (`verifySession`): emit an `auth.session.lookup` failure before
  throwing `SessionNotFound` — `outcome: 'failure'`, `error_code: 'SESSION_NOT_FOUND'`, `credential_kind`.
  Today that throw is completely silent; the only trace is the generic `request.error` line.
- **`src/auth/middleware.ts:59-67`** (`auth.jwt.verification` failure): add `error_code` from the jose
  error (`JWTExpired`, `JWSSignatureVerificationFailed`, …) and `credential_kind`. Currently only
  `error_name`, which cannot distinguish "expired" from "wrong key".
- **`src/auth/middleware.ts:74-77`** (`INVALID_JWT_PAYLOAD`): log before throwing — currently silent.
- **`src/auth/handlers/token.ts:23-25`**: emit `auth.token.rejected` (warn) before
  `throw new SessionNotFound(c)`, with `credential_kind` and the better-auth response status. Keep
  `auth.token.issued` as the success event — `token.integration.test.ts:47-54` asserts on it.
- **`src/auth/middleware.ts:113-121`** (`auth.session.lookup` success): add `session_expires_in_s` and
  `session_age_s` derived from the session row. This is what makes the once-a-day refresh cadence, and any
  drift in it, visible over time.

### App (KamaalLogger — string-only, no structured fields)

`KamaalLogger` has no metadata parameter; the closest existing convention is the variadic
`info(_ messages: String...)` / `warning(_:)` overloads, which join with `"; "`. Adopt one shape for all
new session logs — a sentence, then `key=value` pairs:

`"Refreshing the authentication token; reason=session_update_age; credential=session_token; auth_token_age_s=86412"`

Log messages are plain literals and must **not** be localized (no `String(localized:)`, no `.xcstrings`
entries) — that convention holds across all 21 existing call sites; keep it.

Never log a token value or any part of one. `authToken`/`sessionToken` are plain `String`s on
`Credentials`; log `credential=jwt|session_token` and time deltas in seconds only.

- **`SessionAuthorizationMiddleware.swift`** — currently has zero logging and no logger import, yet owns
  every decision that matters. Add a logger and cover: the refresh decision with its reason
  (`session_update_age` vs `auth_token_expiring`) and the relevant age/remaining seconds; the credential
  attached to the outgoing request plus `operationID` (already a parameter at line 22, currently unused);
  the credential-deletion branch (a silent sign-out today); and the refresh failure at line 46.
- **`SessionTokenAuthorizationMiddleware.swift`** (new) — log that the session-token credential was
  attached, with `operationID`.
- **`TokenRefresher.swift:25-57`** — `refreshToken()` is entirely silent, which is why the incident
  produced no app-side detail. Log entry, and each exit: success, `.unauthorized`/`.notFound` (including
  that credentials were deleted), and `.undocumented` with its status code.
- **`TokenRefresher.swift:101-109`** — `deleteCredentials` should say why it was called.
- **`TCGAuthClient.swift:37-87`** — `session()` has no logging at all; all seven failure paths are silent.
  Log each with its status/case.
- **`TCGAuth.swift:99-112`** — the mapped `SessionErrors` is carried into `serverUnavailable(context:)` /
  `unauthorized(context:)` and then discarded at line 111. Include it in the message, and log the
  currently-silent `.unauthorized` branch (line 101-102) — that branch signs the user out with no record.

## Part E — Tests

**Delete** `app/Modules/TCGClient/Tests/TCGClientTests/TCGSessionRefreshRegressionTests.swift`.

**Move its two cases into `TCGAuthClientTests.swift`**, reusing that file's existing `RequestTransport`
actor and `CredentialsStoreSpy`. `RequestTransport` needs a server-accurate mode — a factory (e.g.
`serverLike()`) whose `send` returns 404 `SESSION_NOT_FOUND` for `get/app-api/auth/token` unless the
bearer is the session token, and 200 for `get/app-api/auth/session` on a JWT bearer. The two cases are:

1. the refresh request carries `Bearer session-token`;
2. credentials one day past `sessionUpdateAge` with a live JWT still load a session successfully, and no
   credentials are deleted.

**Existing assertions that encode the bug and must flip to `Bearer session-token`:**
`TCGAuthClientTests.swift:645` (`assertRefreshTokenRequest`) and `:657` (`assertAutomaticRefreshRequests`).

**New app coverage:**

- expired JWT + live session → refreshes rather than wiping (Part B);
- refresh 404 → credentials deleted and `.unauthorized` reaches `TCGAuth` as a sign-in prompt, not
  `.serverUnavailable` (Part C);
- a legacy keychain payload using the old `expiryDate` key decodes without forcing a sign-out (Part B);
- `storeCredentials` preserves `sessionExpiryDate` across a refresh (Part B).

**Call sites that must be updated for the new `Credentials` shape:** `TCGClient.swift:101`,
`TCGAuthClientTests.swift:588-600` (`makeCredentials`), `TCGCardsClientTests.swift:127`,
`TCGPricingClientTests.swift:84`, `PreviewTCGClientTests.swift:43`,
`TCGFeatures/Tests/TCGAuthTests/TCGAuthTestHelpers.swift:30`. If any `PreviewTCGAuthClient` outcome or
scenario changes, add matching tests to `PreviewTCGClientTests.swift`.

**Server tests** (`src/auth/tests/`, using the `getLogsForRequestId` / `withRequestId` fixtures from
`src/tests/fixtures.ts`):

- Keep the already-added `rejects the issued JWT as a bearer credential` case in
  `token.integration.test.ts` — it pins the contract that this whole fix depends on.
- Assert each new event and its fields, following `session.integration.test.ts:45-57`. Note `msg` is part
  of the asserted contract in this codebase.
- Add a leak guard per new log site: `expect(JSON.stringify(logs)).not.toContain(createdUser.sessionToken)`,
  as in `sign-out.integration.test.ts:33,48`.

No test may hit the network, and no test may branch to reach its assertion.

## Verification

1. `just download-spec` after the route change, and commit the regenerated
   `app/Modules/TCGClient/Sources/TCGClient/openapi.yaml`.
2. `just test-server` — new auth log events, the JWT-bearer rejection, and the leak guards.
3. From `app/Modules/TCGClient`: `swift test` for the fast client-layer loop.
4. `just ready` last — must pass before this is called done. It runs `quality` (including `check-spec`)
   and both server and app test suites.
5. Manual end-to-end, since the failure only appears across a day boundary: sign in against the local
   server, then edit the stored `lastSessionUpdate` back by more than 86400s (or temporarily lower
   `BETTER_AUTH_SESSION_UPDATE_AGE_DAYS`), relaunch, and confirm the app stays signed in. The server log
   should show `auth.token.issued` with `outcome: 'success'`, and the app log should show the refresh
   decision with `credential=session_token`.

# Development

[Back to README](../README.md)

## Tools and first setup

Use the repository root for commands and prefer the [justfile](../justfile)
recipes. Use `pnpm` for Node work. Tool versions live in [mise.toml](../mise.toml):
Node 26, Swift 6.4, and pnpm 12.5.1. Install `just` and Docker with Compose too.
macOS with Xcode is required for app builds and tests.

```sh
just
cp .env.example .env    # first setup only
just prepare
pnpm exec auth secret
```

Put the generated secret in `.env` as `BETTER_AUTH_SECRET`. `just prepare`
installs workspace dependencies and Husky hooks; Xcode resolves Swift packages
when opening/building the app. The pre-commit hook runs lint-staged, which can
format staged files.

The root `.env` is ignored by Git and loaded/exported by `just`. It provides
configuration to recipes that run from `server/`; use recipes rather than assuming
a direct Node invocation loads it.

## Local server and services

```sh
just dev-server
```

The recipe installs Node dependencies, starts Compose services, initializes the
Garage bucket and access key, runs migrations, and starts the server in watch
mode with debugging enabled. Stop the foreground server with Ctrl-C. Manage
sidecars separately:

```sh
just start-services    # PostgreSQL and Garage; initialize the image bucket
just migrate           # apply committed migrations
just stop-services     # remove service containers; named volumes retain data
```

Default host ports are API `8080`, PostgreSQL `5432`, and Garage S3 `9000`.
`GET /health/ping` returns `{"message":"PONG"}`; it is a liveness endpoint and does
not check database or storage connectivity. Swagger UI is at `/doc`, with contracts
at `/spec.json` and `/spec.yaml`.

The [dev container](../.devcontainer/README.md) provides a Linux environment for
server work and Swift formatting. Its database and storage are sidecars with
container-specific connection settings. Start/stop services with the root
recipes, and manage the dev container from the host with `devcontainer-*` recipes.
Run app checks on macOS.

## Configuration

[.env.example](../.env.example) is the local starting point.
[server/src/env.ts](../server/src/env.ts) defines validated server settings and
defaults; Better Auth also reads `BETTER_AUTH_SECRET`.

| Setting                                                            | Purpose / default                                                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                             | HTTP port; `8080`, accepted range `1000`–`9999`                                                                              |
| `DATABASE_URL`                                                     | PostgreSQL connection; local value supplied by `.env.example` or `just`                                                      |
| `BETTER_AUTH_URL`                                                  | Auth base URL and generated OpenAPI server URL; root recipes default to `http://localhost:$PORT`                             |
| `BETTER_AUTH_SECRET`                                               | Auth secret; replace the example value with generated secret material                                                        |
| `PUBLIC_BASE_URL`                                                  | Base URL for image proxy links; defaults to `BETTER_AUTH_URL`                                                                |
| `MODE`                                                             | `SERVER` normally; `TEST` is used by tests                                                                                   |
| `DEBUG`, `LOG_LEVEL`                                               | Debug output and logging verbosity; environment-schema defaults are `false` and `info`, while `dev-server` enables debugging |
| `BETTER_AUTH_SESSION_EXPIRY_DAYS`                                  | Session lifetime; `30`                                                                                                       |
| `BETTER_AUTH_SESSION_UPDATE_AGE_DAYS`                              | Session update interval; `1`                                                                                                 |
| `JWT_EXPIRY_DAYS`                                                  | API JWT lifetime; `7`                                                                                                        |
| `SCRYDEX_CLIENT`                                                   | `static` by default; use `real` for live pricing                                                                             |
| `SCRYDEX_API_KEY`, `SCRYDEX_TEAM_ID`                               | Both required when `SCRYDEX_CLIENT=real`                                                                                     |
| `SCRYDEX_BASE_URL`                                                 | Provider base URL; `https://api.scrydex.com`                                                                                 |
| `SCRYDEX_REQUEST_TIMEOUT_MS`                                       | Provider request timeout; `8000`                                                                                             |
| `PRICING_LOCK_TIMEOUT_MS`                                          | Maximum wait for a pricing advisory lock; `12000`                                                                            |
| `OBJECT_STORAGE_ENDPOINT`                                          | Local Garage URL; omit for AWS S3 endpoint discovery                                                                         |
| `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`                   | `us-east-1` and `tcg-card-images`                                                                                            |
| `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY` | Required to serve the API; local examples match Garage initialization                                                        |
| `OBJECT_STORAGE_FORCE_PATH_STYLE`                                  | `true`; configure for the selected S3 provider                                                                               |
| `OBJECT_STORAGE_REQUEST_TIMEOUT_MS`, `OBJECT_STORAGE_MAX_ATTEMPTS` | Storage request timeout `5000` and SDK attempts `2`                                                                          |

Image worker limits, lease durations, and retry settings are listed in
`server/src/env.ts` and explained in [card images](../server/docs/card-images.md).
The sample storage credentials and single-node Garage configuration are for local
development. Configure your own database, auth secret, storage credentials,
bucket, and public URLs for a deployed environment.

Static pricing uses canned cards and synthetic search matches, with separate
cache identities from the live provider. It does not require Scrydex credentials
or make pricing-provider requests. Some sample image URLs use `images.example.com`,
so static pricing does not guarantee downloadable card art. See the
[API guide](../server/docs/api.md#pricing-behavior) for pricing semantics.

### Ports and worktrees

When changing host ports, keep connection URLs aligned: `TCG_DB_PORT` with
`DATABASE_URL`, `TCG_STORAGE_PORT` with `OBJECT_STORAGE_ENDPOINT`, and `PORT` with
`BETTER_AUTH_URL`. Update `PUBLIC_BASE_URL` too when explicitly set. The app's
compiled URL is configured separately; changing `.env` alone does not redirect it.

If you use Herdr, `just herdr-worktree <new-branch>` creates a checkout based on
`origin/main`, copies the source `.env`, and allocates separate API, database, and
storage ports plus a Compose project name. It needs Herdr, an existing local
`.env`, and local connection URLs. See
[scripts/create-herdr-worktree.ts](../scripts/create-herdr-worktree.ts).

## Changing the database or API

For a database change, edit schemas under `server/src/db/schema/`, then:

```sh
just make-migrations
just migrate
```

Review and commit the generated migration SQL and Drizzle metadata under
`server/drizzle/` with the schema change. `just make-auth-tables` regenerates
Better Auth's schema from its configuration; review that output before generating
a migration.

For an API contract change, update routes/schemas and regenerate the Swift client's
committed contract:

```sh
just download-spec
just check-spec
```

These recipes instantiate the app and generate the spec in process; they do not
start an HTTP server. They set the spec base URL to `http://localhost:8080` for
reproducible output. Xcode's OpenAPI generator builds Swift types from the YAML.
See [app development](../app/README.md#api-contract-and-server-url) for the client
workflow. Read [logging](../server/docs/logging.md) before adding server events.

## Production server image

```sh
just build-server-image    # builds tcg-server:local using versions from mise.toml
just test-server-image     # builds the image, checks liveness and runtime contents
```

The root [Dockerfile](../Dockerfile) installs production Node dependencies in a
separate stage and runs the TypeScript server directly as the non-root `node`
user. It exposes port 8080; supply configuration at runtime and publish the port
in your deployment. The image does not bundle `.env` or run migrations.

Configure `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, storage
credentials, region/bucket, and an endpoint when required by your S3 provider.
Enable live Scrydex explicitly if desired. Apply `just migrate` separately against
the target database before deploying changes that require migrations. The image
smoke test disables the worker and checks `/health/ping`; it does not verify
database, storage, or live-provider connectivity.

## Verification and CI

Run `just quality` first while iterating. For code changes, run the matching
aggregate last: `just ready-server` for server-only changes, `just ready-app` for
app-only changes, or `just ready` for both. Documentation-only changes may skip
these aggregates.

| Recipe                                                 | Coverage                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `just quality`                                         | OpenAPI freshness, version synchronization, formatting, lint, and TypeScript checks |
| `just quality-server`                                  | Server OpenAPI, JS formatting/lint, and server typecheck                            |
| `just quality-app`                                     | Strict Swift formatting                                                             |
| `just lint`, `just format-check`, `just typecheck`     | Narrower checks during iteration                                                    |
| `just test-server`                                     | Vitest; real PostgreSQL and Garage started by Testcontainers                        |
| `just test-server-image`                               | Production Docker build and isolated liveness/runtime smoke test                    |
| `just test-app-macos`, `just test-app-ios`             | Xcode scheme tests on each platform                                                 |
| `just test-snapshots-macos`, `just test-snapshots-ios` | Screen and image-view snapshot suites                                               |
| `just test`                                            | Server and image smoke test, both app platforms, and repository script tests        |
| `just format`                                          | Apply JS and Swift formatting                                                       |

Repository script tests use Vitest without Docker or Xcode after installing
workspace dependencies:

```sh
just test-scripts                  # all script suites (also pnpm test)
just test-herdr-worktree           # worktree environment tests
just test-check-versions-in-sync   # version synchronization tests
just test-localization-check      # localization checker and CLI tests
pnpm test scripts/check-localizations.test.ts  # filter by file
pnpm test:watch                   # watch script tests
```

Root Vitest commands discover only `scripts/**/*.test.ts`; server tests keep
their separate configuration and setup.

Server tests create isolated databases and buckets via shared test fixtures and
unset live Scrydex credentials. They need a working Docker daemon, but do not need
the development server or Compose services running. Swift client tests use
controlled transports; screen snapshots use preview dependencies.

Always use `just test-app-ios` or `just test-snapshots-ios` for iOS tests. Their
wrapper serializes the shared CoreSimulator device locally. Automation agents must
run simulator recipes outside a filesystem sandbox. Use `just app-destinations`
to inspect destinations, and set `TCG_APP_IOS_TEST_DESTINATION` if needed. The local
default is `platform=iOS Simulator,OS=27.0,name=TCG Test iPhone`. Set
`TCG_APP_CODE_SIGNING_ALLOWED=YES` if signed test builds are needed; the recipes
default to unsigned builds (`NO`).

[CI](../.github/workflows/ci.yml) detects affected areas for PRs. Server checks
and the image smoke test run on Linux; macOS app tests and iOS snapshots run on
`xcode-27`. Pushes to `main` run both areas. The
[affected-area configuration](../.github/config/affected-areas.conf)
determines which paths trigger each job.

### Snapshot failures

Download the failure artifact from the affected GitHub Actions run:

```sh
gh run download <run-id> -n macos-snapshot-failures
gh run download <run-id> -n ios-snapshot-failures
```

The collector reads persistent `.snapshot-failures/` output, macOS/simulator
temporary files, and new references. iOS CI also passes an `.xcresult` bundle so
its reference, failure, and diff attachments are exported under `attachments/`.

Artifacts are uploaded on failure and retained for seven days. Compare the taken
PNG with the committed reference under the suite's `__Snapshots__` directory
before recording a new baseline. Artifacts also include new untracked references
and runner/Xcode versions. Name suites `…SnapshotTests` so the collector finds
them. Record on CI's destination: `xcode-27` for macOS and `iPhone 17` on iOS 27.0
for iOS, then rerun CI after committing reviewed references.

## Troubleshooting

- **Server refuses to start:** check the two object-storage credential settings,
  copy the matching local settings from `.env.example`, and run
  `just start-services`. Check endpoint and bucket configuration too.
- **Database connection fails:** verify Docker is running, services are healthy,
  `DATABASE_URL` matches the published PostgreSQL port, and migrations are applied.
- **App cannot reach the API:** check the compiled OpenAPI server URL. Physical
  devices cannot use the Mac's `localhost`; see the [app guide](../app/README.md).
- **Pricing looks artificial or images are absent:** the default provider is
  static. Use `SCRYDEX_CLIENT=real` with both credentials for live data.
- **OpenAPI check fails:** run `just download-spec`, inspect the contract diff,
  and commit it alongside the endpoint/client change.
- **iOS destination is unavailable:** run `just app-destinations` and configure
  `TCG_APP_IOS_TEST_DESTINATION` to match an installed simulator.

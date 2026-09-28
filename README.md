# TCG 🎴

TCG is an iOS and macOS app for tracking a trading card collection and searching
card prices. It currently supports **Pokémon** and **One Piece**.

- Manage owned cards with their set, card number, notes, and quantities per condition.
- Filter the collection by game and view daily pricing alongside owned cards.
- Search cards by name or number, with images, Near Mint pricing, and price trends
  when the provider supplies them.
- Sign up and sign in with email and password; sign out and view the app version
  in Settings.

The repository contains a modular SwiftUI app and a TypeScript/Hono API. The
server uses PostgreSQL with Drizzle, Better Auth, Scrydex for live pricing, and
S3-compatible object storage for card images. Local development defaults to
sample pricing, so Scrydex credentials are optional.

## Get started

Install the versions in [mise.toml](mise.toml) (Node 26, Swift 6.4, pnpm 12.5.1),
plus `just` and Docker with Compose. App builds also need macOS and Xcode with
Swift 6.4 support; the app target's deployment minimums are iOS 18.6 and macOS 27.

Run commands from the repository root:

```sh
just                    # discover available recipes
cp .env.example .env    # first setup only; preserve an existing .env
just prepare            # install workspace dependencies and Git hooks
```

Replace `BETTER_AUTH_SECRET=secret` in `.env` with a generated value:

```sh
pnpm exec auth secret
```

To run the server:

```sh
just dev-server
```

This installs server dependencies, starts PostgreSQL and Garage, initializes
object storage, applies migrations, and runs the API with watch mode and the Node
inspector. With the default configuration, open
[Swagger UI](http://localhost:8080/doc) or check
[health](http://localhost:8080/health/ping).

To run the app, use `just xcode`, select the `TCG` scheme and a supported Mac or
iOS simulator, then run it. Its default API URL is `http://localhost:8080`.
See [app development](app/README.md) for endpoint configuration and device setup.

For a Linux server/tooling environment, use the
[dev container guide](.devcontainer/README.md). Xcode builds remain on the Mac.

## Documentation

| Guide                                     | Contents                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| [Development](docs/development.md)        | Setup, configuration, migrations, checks, CI, and troubleshooting       |
| [Architecture](docs/architecture.md)      | Repository map, module boundaries, data model, and request flow         |
| [App](app/README.md)                      | Swift packages, authentication, API generation, previews, and snapshots |
| [Server](server/README.md)                | Server setup and links to backend guides                                |
| [API](server/docs/api.md)                 | Routes, authentication, card payloads, pricing, and error behavior      |
| [Card images](server/docs/card-images.md) | Object storage, durable work queue, retries, and refreshes              |
| [Logging](server/docs/logging.md)         | Structured events, field vocabulary, and logging rules                  |
| [Dev container](.devcontainer/README.md)  | Container lifecycle, sidecars, and tool versions                        |

## Verification

Start with `just quality`. For code changes, finish with the recipe matching the
scope:

```sh
just ready-server       # server quality, integration tests, and Docker image smoke test
just ready-app          # Swift formatting and macOS/iOS app tests
just ready              # all checks, including repository tooling
```

Server tests need a Docker daemon and create their own PostgreSQL and Garage
containers. App tests need Xcode; iOS tests must use the repository recipes to
serialize access to the shared simulator. Documentation-only changes do not
require the `ready` recipes. See [development](docs/development.md#verification-and-ci)
for narrower checks and snapshot failure handling.

# TCG server

Run every recipe from the repository root.

```sh
cp .env.example .env   # first time only
just start-services    # Postgres and Garage
just migrate
just dev-server
```

```sh
open http://localhost:8080
```

The server refuses to start without object storage credentials — see
[Card images](docs/card-images.md) if that is what stopped you.

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

- [Logging](docs/logging.md) — how structured logging works here, the field vocabulary, and how to add an event.
- [Card images](docs/card-images.md) — the image cache, its work queue, and how it behaves across instances.

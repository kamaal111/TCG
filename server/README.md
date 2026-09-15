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
just test-server       # needs Postgres up and a Docker daemon
just ready-server      # both of the above
```

## Documentation

- [Logging](docs/logging.md) — how structured logging works here, the field vocabulary, and how to add an event.
- [Card images](docs/card-images.md) — the image cache, its work queue, and how it behaves across instances.

#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
cp "$root/deploy/compose.yml" "$root/deploy/Caddyfile" "$temporary/"
printf 'DATABASE_URL=postgresql://fixture:fixture@localhost/fixture\n' > "$temporary/server.env"
printf 'API_HOSTNAME=\n' > "$temporary/host.env"
printf 'TCG_RUNTIME_IMAGE=tcg-server:local\nTCG_MIGRATION_IMAGE=tcg-server-migrations:local\n' > "$temporary/release.env"
docker compose --project-directory "$temporary" --env-file "$temporary/host.env" \
    --env-file "$temporary/release.env" config --quiet
printf 'API_HOSTNAME=api.example.com\n' > "$temporary/host.env"
docker compose --project-directory "$temporary" --env-file "$temporary/host.env" \
    --env-file "$temporary/release.env" --profile public config --quiet
echo 'Private and public deployment Compose configurations are valid.'

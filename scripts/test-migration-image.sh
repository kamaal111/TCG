#!/usr/bin/env bash
set -euo pipefail
network="tcg-migration-check-$$-$RANDOM"
database=''
cleanup() {
    [[ -z "$database" ]] || docker rm --force "$database" > /dev/null
    docker network rm "$network" > /dev/null
}
docker network create "$network" > /dev/null
trap cleanup EXIT
database="$(docker run --detach --network "$network" --network-alias postgres \
    --env POSTGRES_PASSWORD=migration-test-only postgres:18)"
ready=false
for attempt in {1..30}; do
    if docker exec "$database" pg_isready -U postgres > /dev/null 2>&1; then
        ready=true
        break
    fi
    sleep 1
done
[[ "$ready" == true ]] || { echo 'Isolated migration database did not become ready.' >&2; exit 1; }
for attempt in 1 2; do
    docker run --rm --network "$network" \
        --env DATABASE_URL=postgresql://postgres:migration-test-only@postgres:5432/postgres \
        tcg-server-migrations:local
done
count="$(docker exec "$database" psql -U postgres -tAc 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
[[ "$count" =~ ^[1-9][0-9]*$ ]] || { echo 'Migration history was not persisted.' >&2; exit 1; }
docker run --rm --entrypoint node tcg-server-migrations:local --check scripts/check-deployment.ts
echo 'Migration image applied successfully twice against an isolated PostgreSQL database.'

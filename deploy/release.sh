#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() { echo "$1" >&2; exit 1; }
directory="${TCG_DEPLOY_DIRECTORY:-/opt/tcg}"
cd "$directory"
lock="$directory/.deployment-lock"
mkdir "$lock" 2>/dev/null || fail 'Another host configuration or deployment is running.'
temporary=''
cleanup() {
    [[ -z "$temporary" ]] || rm -rf "$temporary"
    rmdir "$lock"
}
trap cleanup EXIT

compose() {
    docker compose --env-file host.env --env-file release.env "$@"
}

if [[ "${1:-}" == check && $# == 1 ]]; then
    [[ -f release.env ]] || fail 'No release is installed.'
    compose run --rm --no-deps tools node scripts/check-deployment.ts
    curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8080/health/ping
    exit 0
fi

[[ "${1:-}" == release && $# == 5 ]] || fail 'Expected release RUNTIME_DIGEST MIGRATION_DIGEST private|public true|false.'
runtime="$2"
migration="$3"
exposure="$4"
rollback="$5"
repository="$(cat registry-repository)"
[[ "$repository" =~ ^ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+$ ]] || fail 'Invalid registry repository allowlist.'
digest_pattern='sha256:[a-f0-9]{64}'
[[ "$runtime" == "$repository@"* && "${runtime#*@}" =~ ^${digest_pattern}$ ]] || fail 'Runtime must be an allowed immutable GHCR digest.'
[[ "$migration" == "$repository-migrations@"* && "${migration#*@}" =~ ^${digest_pattern}$ ]] || fail 'Migration must be an allowed immutable GHCR digest.'
[[ "$exposure" == private || "$exposure" == public ]] || fail 'Unknown exposure mode.'
[[ "$rollback" == true || "$rollback" == false ]] || fail 'Rollback compatibility must be explicitly true or false.'

hostname="$(sed -n 's/^API_HOSTNAME=//p' host.env)"
if [[ "$exposure" == public ]]; then
    [[ "$hostname" =~ ^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$ ]] || fail 'Public deployment requires a configured API hostname.'
    grep -Fxq "BETTER_AUTH_URL=https://$hostname" server.env || fail 'Authentication URL does not match the public hostname.'
else
    [[ -z "$hostname" ]] || fail 'A configured public host must be deployed in public mode.'
fi

temporary="$(mktemp -d "$directory/.release.XXXXXX")"
printf 'TCG_RUNTIME_IMAGE=%s\nTCG_MIGRATION_IMAGE=%s\n' "$runtime" "$migration" > "$temporary/release.env"

# Pull and check dependencies before modifying the running release or database schema.
docker pull "$runtime"
docker pull "$migration"
runtime_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$runtime")"
migration_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$migration")"
[[ "$runtime_revision" =~ ^[a-f0-9]{40}$ && "$runtime_revision" == "$migration_revision" ]] || fail 'Runtime and migration images must come from the same commit.'

candidate() {
    docker compose --env-file host.env --env-file "$temporary/release.env" "$@"
}
candidate config --quiet
candidate run --rm --no-deps tools node scripts/check-deployment.ts
if [[ "$exposure" == public ]]; then
    candidate run --rm --no-deps proxy caddy validate --config /etc/caddy/Caddyfile
fi
candidate run --rm --no-deps tools node scripts/migrate.ts

if [[ -f release.env ]]; then
    cp release.env "$temporary/previous.env"
fi
mv "$temporary/release.env" release.env

start_release() {
    compose up --detach --wait --wait-timeout 120 server || return 1
    if [[ "$exposure" == public ]]; then
        compose --profile public up --detach --wait --wait-timeout 120 proxy || return 1
        curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors --max-time 10 "https://$hostname/health/ping" || return 1
    else
        compose --profile public stop proxy || return 1
    fi
    compose run --rm --no-deps tools node scripts/check-deployment.ts || return 1
    curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8080/health/ping || return 1
}

if start_release; then
    if [[ -f "$temporary/previous.env" ]]; then
        cp "$temporary/previous.env" previous-release.env
    fi
    echo 'Release checks passed.'
else
    if [[ -f "$temporary/previous.env" && "$rollback" == true ]]; then
        cp "$temporary/previous.env" release.env
        compose up --detach --wait --wait-timeout 120 server
        echo 'Restored previous application image; database migrations were retained.' >&2
    else
        echo 'Automatic rollback was not authorized as schema-compatible. Inspect the deployment.' >&2
    fi
    exit 1
fi

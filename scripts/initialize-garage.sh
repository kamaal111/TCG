#!/usr/bin/env bash

set -euo pipefail

: "${OBJECT_STORAGE_ACCESS_KEY_ID:?OBJECT_STORAGE_ACCESS_KEY_ID is required}"
: "${OBJECT_STORAGE_SECRET_ACCESS_KEY:?OBJECT_STORAGE_SECRET_ACCESS_KEY is required}"
: "${OBJECT_STORAGE_BUCKET:?OBJECT_STORAGE_BUCKET is required}"

garage() {
    docker compose exec -T garage /garage -c /etc/garage.toml "$@"
}

node_id="$(garage status | awk '/NO ROLE ASSIGNED/ { print $1; exit }')"

if [[ -n "$node_id" ]]; then
    garage layout assign -z local -c 1G "$node_id"
    garage layout apply --version 1
fi

if ! garage key info "$OBJECT_STORAGE_ACCESS_KEY_ID" >/dev/null 2>&1; then
    garage key import \
        -n tcg-local \
        --yes \
        "$OBJECT_STORAGE_ACCESS_KEY_ID" \
        "$OBJECT_STORAGE_SECRET_ACCESS_KEY"
fi

if ! garage bucket info "$OBJECT_STORAGE_BUCKET" >/dev/null 2>&1; then
    garage bucket create "$OBJECT_STORAGE_BUCKET"
fi

garage bucket allow \
    --read \
    --write \
    "$OBJECT_STORAGE_BUCKET" \
    --key "$OBJECT_STORAGE_ACCESS_KEY_ID"

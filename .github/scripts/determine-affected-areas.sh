#!/usr/bin/env bash

set -euo pipefail

: "${EVENT_NAME:?EVENT_NAME is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

source "$(dirname "${BASH_SOURCE[0]}")/affected-areas.sh"

if [[ "$EVENT_NAME" == push && "${REF_NAME:-}" == main ]]; then
    printf 'server=true\napp=true\n' >> "$GITHUB_OUTPUT"
    exit 0
fi

: "${BASE_REF:?BASE_REF is required for pull requests}"
git fetch --no-tags origin "refs/heads/$BASE_REF"
base_commit="$(git merge-base HEAD FETCH_HEAD)"
area="$(git diff --name-only -z "$base_commit" HEAD | classify_affected_paths --log)"

server=false
app=false
if [[ "$area" == server || "$area" == both ]]; then
    server=true
fi
if [[ "$area" == app || "$area" == both ]]; then
    app=true
fi

printf 'server=%s\napp=%s\n' "$server" "$app" >> "$GITHUB_OUTPUT"

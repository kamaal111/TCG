#!/usr/bin/env bash

set -euo pipefail

: "${EVENT_NAME:?EVENT_NAME is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

config_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config/affected-areas.conf"
source "$config_file"

matches_any() {
    local file="$1"
    shift

    local pattern
    for pattern in "$@"; do
        if [[ "$file" == $pattern ]]; then
            return 0
        fi
    done

    return 1
}

if [[ "$EVENT_NAME" == push && "${REF_NAME:-}" == main ]]; then
    printf 'server=true\napp=true\n' >> "$GITHUB_OUTPUT"
    exit 0
fi

: "${BASE_REF:?BASE_REF is required for pull requests}"
git fetch --no-tags origin "refs/heads/$BASE_REF"
base_commit="$(git merge-base HEAD FETCH_HEAD)"
changed_file_list="$(mktemp)"
trap 'rm -f "$changed_file_list"' EXIT
git diff --name-only -z "$base_commit" HEAD > "$changed_file_list"

server=false
app=false

while IFS= read -r -d '' file; do
    printf 'Changed: %s\n' "$file"

    if matches_any "$file" "${BOTH[@]}"; then
        server=true
        app=true
    elif matches_any "$file" "${SERVER[@]}"; then
        server=true
    elif matches_any "$file" "${APP[@]}"; then
        app=true
    fi
done < "$changed_file_list"

printf 'server=%s\napp=%s\n' "$server" "$app" >> "$GITHUB_OUTPUT"

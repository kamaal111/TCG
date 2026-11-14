#!/usr/bin/env bash

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

classify_affected_paths() {
    local server=false
    local app=false
    local file

    while IFS= read -r -d '' file; do
        if [[ "${1:-}" == --log ]]; then
            printf 'Changed: %s\n' "$file" >&2
        fi

        if [[ "$file" == *.md ]]; then
            continue
        fi

        if matches_any "$file" "${BOTH[@]}"; then
            server=true
            app=true
        elif matches_any "$file" "${APP[@]}"; then
            app=true
        elif matches_any "$file" "${SERVER[@]}"; then
            server=true
        fi
    done

    if $server && $app; then
        printf 'both\n'
    elif $server; then
        printf 'server\n'
    elif $app; then
        printf 'app\n'
    else
        printf 'other\n'
    fi
}

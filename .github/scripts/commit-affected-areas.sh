#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/affected-areas.sh"

for commit in "$@"; do
    sha="${commit%%:*}"
    parent="${commit#*:}"
    if [[ -n "$parent" ]]; then
        git diff-tree --no-commit-id --no-renames --name-only -r -z "$parent" "$sha" -- | classify_affected_paths
    else
        git diff-tree --root --no-commit-id --no-renames --name-only -r -z "$sha" -- | classify_affected_paths
    fi
done

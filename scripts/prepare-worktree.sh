#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 || -z "$1" ]]; then
    echo 'Usage: just prepare-worktree <new-branch>' >&2
    exit 1
fi
branch="$1"
git check-ref-format --branch "$branch" >/dev/null
if git show-ref --verify --quiet "refs/heads/$branch"; then
    echo "Branch $branch already exists" >&2
    exit 1
else
    status=$?
    if [[ "$status" != 1 ]]; then
        echo 'Could not check whether the branch exists' >&2
        exit "$status"
    fi
fi
git fetch origin main

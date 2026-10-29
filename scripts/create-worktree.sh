#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/native-worktree-common.sh"

[[ $# -ge 1 && $# -le 2 ]] || fail 'Usage: just create-worktree <new-branch> [base]'
branch="$1"
validate_branch "$branch"
if git show-ref --verify --quiet "refs/heads/$branch"; then
    fail "Branch $branch already exists"
else
    status=$?
    [[ "$status" == 1 ]] || fail 'Could not check whether the branch exists'
fi
managed_checkout "$branch"
[[ ! -e "$checkout" ]] || fail "Destination already exists: $checkout"

base="${2-origin/main}"
if [[ $# == 1 ]]; then
    git fetch origin main
fi
revision="$(git rev-parse --verify --end-of-options "$base^{commit}")" || fail "Cannot resolve base: $base"
mkdir -p "$(dirname "$checkout")"
git worktree add -b "$branch" -- "$checkout" "$revision"
printf 'Created worktree: %s\n' "$checkout"
if (cd "$checkout" && just setup-worktree); then
    printf 'Ready: %s\n' "$checkout"
else
    status=$?
    printf 'Setup failed; checkout preserved at %s\nRetry: cd %q && just setup-worktree\n' "$checkout" "$checkout" >&2
    exit "$status"
fi

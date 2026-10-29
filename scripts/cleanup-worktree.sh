#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/native-worktree-common.sh"

[[ $# == 1 ]] || fail 'Usage: just cleanup-worktree <branch>'
branch="$1"
validate_branch "$branch"
managed_checkout "$branch"
[[ -d "$checkout" ]] || fail "Managed checkout does not exist: $checkout"
case "$(pwd -P)/" in
    "$checkout/"*) fail 'Cannot remove the currently executing checkout' ;;
esac

registered='' found=false
while IFS= read -r -d '' field; do
    case "$field" in
        'worktree '*) registered="${field#worktree }" ;;
        "branch refs/heads/$branch")
            if [[ "$registered" == "$checkout" ]]; then
                found=true
            fi
            ;;
    esac
done < <(git worktree list --porcelain -z)
[[ "$found" == true ]] || fail "No matching registered worktree at $checkout"
git worktree remove -- "$checkout"
printf 'Removed checkout: %s (branch %s retained)\n' "$checkout" "$branch"

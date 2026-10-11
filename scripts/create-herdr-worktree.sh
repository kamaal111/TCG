#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 || -z "$1" || ( $# == 2 && "$2" != --no-focus ) ]]; then
    echo 'Usage: just herdr-worktree <new-branch> [--no-focus]' >&2
    exit 1
fi
branch="$1"
focus="${2:---focus}"
just prepare-worktree "$branch"
root="$(git rev-parse --show-toplevel)"
herdr worktree create --cwd "$root" --branch "$branch" --base origin/main "$focus"

checkout=''
while IFS= read -r -d '' field; do
    case "$field" in
        'worktree '*) checkout="${field#worktree }" ;;
        "branch refs/heads/$branch")
            cd "$checkout"
            exec just setup-worktree
            ;;
    esac
done < <(git worktree list --porcelain -z)
echo "Herdr created $branch, but its checkout was not found" >&2
exit 1

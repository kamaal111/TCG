#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 || -z "$1" ]]; then
    echo 'Usage: just herdr-worktree <new-branch>' >&2
    exit 1
fi
branch="$1"
root="$(git rev-parse --show-toplevel)"
herdr worktree create --cwd "$root" --branch "$branch" --base origin/main --no-focus

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

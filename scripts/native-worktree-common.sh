#!/usr/bin/env bash

fail() {
    echo "$1" >&2
    exit 1
}

validate_branch() {
    [[ -n "$1" && "$1" != -* ]] || fail 'Expected a branch name'
    git check-ref-format "refs/heads/$1" >/dev/null || fail "Invalid branch name: $1"
}

managed_checkout() {
    local field main='' component current
    while IFS= read -r -d '' field; do
        case "$field" in
            'worktree '*) main="${field#worktree }"; break ;;
        esac
    done < <(git worktree list --porcelain -z)
    [[ -n "$main" ]] || fail 'Cannot locate the main checkout'
    main="$(cd "$main" && pwd -P)" || fail 'Cannot access the main checkout'
    checkout="$main/.agents/worktrees/$1"

    # Reject symlinks at every level, including grouping directories in branch names.
    current="$main"
    local -a components
    IFS=/ read -r -a components <<< ".agents/worktrees/$1"
    for component in "${components[@]}"; do
        current="$current/$component"
        [[ ! -L "$current" ]] || fail "Managed worktree paths must not contain symlinks: $current"
        [[ ! -e "$current" || -d "$current" ]] || fail "Not a directory: $current"
    done
}

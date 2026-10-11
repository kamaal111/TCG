#!/usr/bin/env bash
set -euo pipefail

fail() {
    echo "$1" >&2
    exit 1
}

[[ $# == 0 ]] || fail 'Usage: just setup-worktree'
root="$(git rev-parse --show-toplevel)"
root="$(cd "$root" && pwd -P)"
git_dir="$(git rev-parse --path-format=absolute --git-dir)"
common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
[[ "$git_dir" != "$common_dir" ]] || fail 'Run just setup-worktree inside a linked worktree, not the main checkout'
[[ "$root" == "$(pwd -P)" ]] || fail 'Run just setup-worktree from the checkout root'

lock="$common_dir/tcg-worktree-setup.lock"
if ! mkdir "$lock"; then
    [[ ! -d "$lock" ]] || fail "Worktree setup is locked. Retry after setup finishes; if it was interrupted, remove $lock"
    fail 'Could not acquire the worktree setup lock'
fi

temporary=''
cleanup() {
    if [[ -n "$temporary" ]]; then
        rm -rf "$temporary"
    fi
    rmdir "$lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

umask 077
temporary="$(mktemp -d "$root/.env.setup-XXXXXX")"
git worktree list --porcelain -z > "$temporary/worktrees"
main_checkout=''
peers=()
while IFS= read -r -d '' field; do
    case "$field" in
        'worktree '*)
            checkout="${field#worktree }"
            if [[ -z "$main_checkout" ]]; then
                main_checkout="$checkout"
            fi
            if [[ "$checkout" != "$root" ]]; then
                peers+=("$checkout")
            fi
            ;;
    esac
done < "$temporary/worktrees"

source="$root/.env"
if [[ -e "$source" || -L "$source" ]]; then
    [[ -f "$source" && ! -L "$source" ]] || fail '.env must be a regular file, not a symlink'
else
    [[ -n "$main_checkout" && "$main_checkout" != "$root" ]] || fail 'Cannot locate the main checkout; copy .env into this worktree'
    source="$main_checkout/.env"
    [[ -f "$source" ]] || fail 'No .env in this worktree or the main checkout; create or copy .env and retry'
fi

cp -p "$source" "$temporary/.env"
script_dir="$(dirname "${BASH_SOURCE[0]}")"
result="$(node "$script_dir/configure-worktree-env.ts" \
    "$root" "$source" "$temporary/.env" "${peers[@]}")"
if ! cmp -s "$temporary/.env" "$root/.env"; then
    mv -f "$temporary/.env" "$root/.env"
fi
printf '%s\n' "$result"

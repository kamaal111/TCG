#!/usr/bin/env bash
set -euo pipefail

# This dispatcher is the forced command for the release SSH key. Never eval input.
read -r action runtime migration exposure rollback extra <<< "${SSH_ORIGINAL_COMMAND:-}"
case "$action" in
    release)
        [[ -z "${extra:-}" && -n "${rollback:-}" ]] || exit 64
        exec /usr/local/sbin/tcg-release release "$runtime" "$migration" "$exposure" "$rollback"
        ;;
    check)
        [[ -z "${runtime:-}" ]] || exit 64
        exec /usr/local/sbin/tcg-release check
        ;;
    migrate)
        [[ -n "${runtime:-}" && -z "${migration:-}" ]] || exit 64
        exec /usr/local/sbin/tcg-release migrate "$runtime"
        ;;
    *) echo 'Only release, check, and explicit migrate are permitted.' >&2; exit 64 ;;
esac

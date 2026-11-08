#!/usr/bin/env bash
set -euo pipefail

# This dispatcher is the forced command for the release SSH key. Never eval input.
read -r action runtime migration exposure rollback fingerprint extra <<< "${SSH_ORIGINAL_COMMAND:-}"
case "$action" in
    release)
        [[ -z "${fingerprint:-}" && -z "${extra:-}" && -n "${rollback:-}" ]] || exit 64
        exec /usr/local/sbin/tcg-release release "$runtime" "$migration" "$exposure" "$rollback"
        ;;
    release-checked)
        [[ -z "${extra:-}" && "${fingerprint:-}" =~ ^[a-f0-9]{64}$ ]] || exit 64
        exec /usr/local/sbin/tcg-release release-checked "$runtime" "$migration" "$exposure" "$rollback" "$fingerprint"
        ;;
    migrate-checked)
        [[ -n "${runtime:-}" && "${migration:-}" =~ ^[a-f0-9]{64}$ && -z "${exposure:-}" ]] || exit 64
        exec /usr/local/sbin/tcg-release migrate-checked "$runtime" "$migration"
        ;;
    status)
        [[ -z "${runtime:-}" ]] || exit 64
        exec /usr/local/sbin/tcg-release status
        ;;
    migration-status)
        [[ -n "${runtime:-}" && -z "${migration:-}" ]] || exit 64
        exec /usr/local/sbin/tcg-release migration-status "$runtime"
        ;;
    check)
        [[ -z "${runtime:-}" ]] || exit 64
        exec /usr/local/sbin/tcg-release check
        ;;
    migrate)
        [[ -n "${runtime:-}" && -z "${migration:-}" ]] || exit 64
        exec /usr/local/sbin/tcg-release migrate "$runtime"
        ;;
    *) echo 'Only supported release operations are permitted.' >&2; exit 64 ;;
esac

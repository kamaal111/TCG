#!/usr/bin/env bash
set -euo pipefail
umask 077

action="${1:-${OPERATION:-}}"
case "$action" in
    verify-revision|checkout-revision)
        git fetch origin main
        revision="$(git rev-parse --verify --end-of-options "${2:-${RELEASE_REVISION:-HEAD}}^{commit}")"
        git merge-base --is-ancestor "$revision" origin/main
        if [[ "$action" == checkout-revision ]]; then
            git checkout --detach "$revision"
        else
            printf '%s\n' "$revision"
        fi
        ;;
    deploy|migrate)
        : "${DEPLOY_KEY:?Set the deployment SSH private key}"
        : "${KNOWN_HOSTS:?Set the verified SSH known_hosts entry}"
        : "${DEPLOY_HOST:?Set the Tailscale hostname or address}"
        : "${MIGRATION_IMAGE:?Set the immutable migration image}"
        if [[ "$action" == deploy ]]; then
            : "${RUNTIME_IMAGE:?Set the immutable runtime image}"
            : "${EXPOSURE:?Set private or public exposure}"
            : "${ROLLBACK:?Set the schema compatibility confirmation}"
            remote_command="release $RUNTIME_IMAGE $MIGRATION_IMAGE $EXPOSURE $ROLLBACK"
        else
            remote_command="migrate $MIGRATION_IMAGE"
        fi
        temporary="$(mktemp -d)"
        trap 'rm -rf "$temporary"' EXIT
        printf '%s\n' "$DEPLOY_KEY" > "$temporary/key"
        printf '%s\n' "$KNOWN_HOSTS" > "$temporary/known_hosts"
        if ! TCG_DEPLOY_HOST="$DEPLOY_HOST" TCG_DEPLOY_KEY="$temporary/key" \
            TCG_KNOWN_HOSTS="$temporary/known_hosts" bash scripts/deployment-ssh.sh \
            "$remote_command" \
            > "$temporary/deployment.log" 2>&1; then
            echo 'Server operation failed. Inspect the Droplet privately for diagnostic details.' >&2
            exit 1
        fi
        echo 'Server operation completed.'
        ;;
    *) echo 'Expected verify-revision, checkout-revision, deploy, or migrate.' >&2; exit 64 ;;
esac

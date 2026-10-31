#!/usr/bin/env bash
set -euo pipefail
: "${TCG_DEPLOY_HOST:?Set the Tailscale hostname or address}"
: "${TCG_DEPLOY_KEY:?Set the SSH private key file path}"
: "${TCG_KNOWN_HOSTS:?Set the verified SSH known_hosts file path}"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$TCG_KNOWN_HOSTS" \
    -i "$TCG_DEPLOY_KEY" "tcg-deploy@$TCG_DEPLOY_HOST" check

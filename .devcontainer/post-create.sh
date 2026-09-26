#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends libncurses6 libpython3.13
rm -rf /var/lib/apt/lists/*

mise install

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "$node_major" != "$(cat .node-version)" ]]; then
    echo "Node $node_major does not match .node-version ($(cat .node-version))." >&2
    echo "Update the node version in mise.toml." >&2
    exit 1
fi

npm install --global @anthropic-ai/claude-code @openai/codex

just prepare

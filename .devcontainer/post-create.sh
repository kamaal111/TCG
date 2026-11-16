#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

mise trust "$PWD/mise.toml"
just prepare

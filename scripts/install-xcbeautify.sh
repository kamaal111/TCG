#!/usr/bin/env bash

set -euo pipefail

if command -v xcbeautify >/dev/null; then
    echo 'xcbeautify is already installed.'
    exit 0
fi

if ! command -v brew >/dev/null; then
    echo 'Installing xcbeautify requires Homebrew. Install it from https://brew.sh, then run `just install-xcbeautify`.' >&2
    exit 1
fi

brew install xcbeautify
command -v xcbeautify >/dev/null

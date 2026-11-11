#!/usr/bin/env bash

set -euo pipefail

if command -v namu >/dev/null; then
    exit 0
fi

if ! command -v brew >/dev/null; then
    echo 'Installing namu requires Homebrew. Install it from https://brew.sh, or put namu on PATH, then retry the recipe.' >&2
    exit 1
fi

echo 'Installing namu through Homebrew...' >&2
if ! brew install kamaal111/tap/namu >&2; then
    echo 'Could not install namu. Resolve the Homebrew error above and retry the recipe.' >&2
    exit 1
fi

if ! command -v namu >/dev/null; then
    echo 'Installation finished, but namu is still unavailable on PATH. Check your Homebrew PATH and retry the recipe.' >&2
    exit 1
fi

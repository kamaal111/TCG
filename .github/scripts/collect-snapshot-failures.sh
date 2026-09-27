#!/usr/bin/env bash
#
# Copies snapshot test failures into one directory so CI can upload them.
#
# SnapshotTesting writes each failing image under a folder named after its
# suite (for example `TCGSearchScreenSnapshotTests/`): in $TMPDIR for macOS
# tests and in the simulator's `data/tmp` for iOS tests. Missing references are
# recorded straight into the repository, so untracked PNGs are copied too.

set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <output-directory>" >&2
    exit 64
fi

output_dir="$1"
mkdir -p "$output_dir"

copy_failures() {
    local label="$1"
    shift
    while IFS= read -r -d '' file; do
        local suite
        suite="$(basename "$(dirname "$file")")"
        mkdir -p "$output_dir/$label/$suite"
        cp -v "$file" "$output_dir/$label/$suite/"
    done < <(find "$@" -type f -path '*SnapshotTests/*.png' -print0 2>/dev/null)
}

copy_failures macos "${TMPDIR:-/tmp}"
simulators="$HOME/Library/Developer/CoreSimulator/Devices"
if [[ -d "$simulators" ]]; then
    while IFS= read -r -d '' tmp_dir; do
        copy_failures ios "$tmp_dir"
    done < <(find "$simulators" -maxdepth 3 -type d -path '*/data/tmp' -print0)
fi

while IFS= read -r -d '' file; do
    mkdir -p "$output_dir/new-references/$(dirname "$file")"
    cp -v "$file" "$output_dir/new-references/$file"
done < <(git ls-files -z --others --exclude-standard -- '*.png')

echo "macOS $(sw_vers -productVersion)"
xcodebuild -version

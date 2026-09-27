#!/usr/bin/env bash
#
# Copies snapshot test failures into one directory so CI can upload them.
#
# SnapshotTesting writes each failing image under a folder named after its
# suite (for example `TCGSearchScreenSnapshotTests/`): in $TMPDIR for macOS
# tests and in the simulator's `data/tmp` for iOS tests. Missing references are
# recorded straight into the repository, so untracked PNGs are copied too.
# An optional result bundle preserves attached reference, failure, and diff
# images even when the simulator removes its temporary files after testing.
# The test plan also sets SNAPSHOT_ARTIFACTS to a persistent host directory.
# Swift Testing image attachments are not always marked failure-associated,
# so export all attachments rather than filtering out those images.

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
    echo "Usage: $0 <output-directory> [result-bundle]" >&2
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

copy_failures captured .snapshot-failures
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

if [[ $# -eq 2 && -d "$2" ]]; then
    xcrun xcresulttool export attachments \
        --path "$2" \
        --output-path "$output_dir/attachments" || echo "Could not export test attachments from $2" >&2
fi

echo "macOS $(sw_vers -productVersion)"
xcodebuild -version

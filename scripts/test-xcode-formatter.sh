#!/usr/bin/env bash

set -euo pipefail

if ! command -v xcbeautify >/dev/null; then
    echo 'Run `just install-xcbeautify` before checking formatter compatibility.' >&2
    exit 1
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture_directory="$(mktemp -d)"
trap 'rm -rf "$fixture_directory"' EXIT

cat > "$fixture_directory/input.log" <<'EOF'
CompileC /tmp/FormatterExample.o /tmp/FormatterExample.c normal arm64 c com.apple.compilers.llvm.clang.1_0.compiler (in target 'FormatterExamples' from project 'FormatterExamples')
◇ Test run started.
◇ Suite "Formatter snapshot examples" started.
◇ Test "Renders an empty add form" started.
✔ Test "Renders an empty add form" passed after 2.215 seconds.
✘ Test "Shows validation errors" failed after 0.500 seconds with 1 issue.
✔ Suite "Formatter snapshot examples" passed after 2.715 seconds.
✔ Test run with 1 test passed after 2.715 seconds.
✔ Test run with 31 tests in 3 suites passed after 3.000 seconds.
Test Suite 'FormatterExamples' started at 2026-10-17 14:00:00.000.
Test Case '-[FormatterExamples testLegacyOutput]' started.
Test Case '-[FormatterExamples testLegacyOutput]' passed (0.123 seconds).
/tmp/FormatterExample.swift:12:3: warning: formatter warning sample
/tmp/FormatterExample.swift:14:3: error: formatter error sample
EOF

assert_contains() {
    if ! grep -Fq -- "$2" "$1"; then
        echo "xcbeautify compatibility check failed: missing '$2' in $3 output." >&2
        echo 'Run `brew upgrade xcbeautify` and retry `just test-scripts`.' >&2
        exit 1
    fi
}

for renderer in terminal github-actions; do
    github_actions=false
    if [[ "$renderer" == github-actions ]]; then
        github_actions=true
    fi
    output="$fixture_directory/$renderer.log"
    GITHUB_ACTIONS="$github_actions" NO_COLOR=1 TCG_XCODE_RAW_OUTPUT=0 \
        TCG_XCODE_LOG_DIR="$fixture_directory/raw" \
        bash "$script_directory/run-with-xcbeautify.sh" "$renderer" \
        cat "$fixture_directory/input.log" > "$output"

    for expected in \
        FormatterExample.c \
        'Formatter snapshot examples' \
        'Renders an empty add form' \
        '2.215' \
        'Shows validation errors' \
        '0.500' \
        'testLegacyOutput' \
        '0.123' \
        'formatter warning sample' \
        'formatter error sample'; do
        assert_contains "$output" "$expected" "$renderer"
    done

    assert_contains "$output" '✔ "Renders an empty add form" (2.215 seconds)' "$renderer"
    if [[ "$renderer" == github-actions ]]; then
        assert_contains "$output" '::error ::"Shows validation errors" (0.500 seconds) 1 issue(s)' "$renderer"
        assert_contains "$output" '::error' "$renderer"
        assert_contains "$output" '::warning' "$renderer"
    else
        assert_contains "$output" '✖ "Shows validation errors" (0.500 seconds) 1 issue(s)' "$renderer"
    fi
done

echo "xcbeautify $(xcbeautify --version): build, Swift Testing, and XCTest visibility checks passed for both renderers."

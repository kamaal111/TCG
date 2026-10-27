#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 2 ]]; then
    echo 'Usage: bash scripts/run-with-xcbeautify.sh LOG_NAME COMMAND [ARGUMENTS...]' >&2
    exit 1
fi

log_name="$1"
shift

if [[ "${TCG_XCODE_RAW_OUTPUT:-}" == 1 ]]; then
    exec "$@"
fi

formatter="$(command -v xcbeautify)" || {
    echo 'xcbeautify is required. Run `just bootstrap` or `just install-xcbeautify` first.' >&2
    exit 1
}

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log_directory="${TCG_XCODE_LOG_DIR:-$script_directory/../.build/xcode-logs}"
log_file="$log_directory/${log_name##*/}.log"
mkdir -p "$log_directory"
: > "$log_file"
echo "Raw Xcode log: $log_file" >&2

pipe_directory="$(mktemp -d)"
trap 'rm -rf "$pipe_directory"' EXIT
mkfifo "$pipe_directory/output"

# Separate process groups let cancellation reach the command and its descendants
# while xcbeautify continues draining the command's cleanup output.
set -m
TCG_XCODE_RAW_OUTPUT=1 "$@" > "$pipe_directory/output" 2>&1 &
command_pid=$!

cancel() {
    kill -s "$1" -- "-$command_pid" 2>/dev/null || true
    wait "$command_pid" 2>/dev/null || true
    wait "${formatter_pid:-}" 2>/dev/null || true
    exit "$2"
}

trap 'cancel INT 130' INT
trap 'cancel TERM 143' TERM

renderer=terminal
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    renderer=github-actions
fi

tee "$log_file" < "$pipe_directory/output" | {
    formatter_status=0
    "$formatter" --renderer "$renderer" || formatter_status=$?
    # Also stop the command if the formatter exits before consuming its output.
    kill -TERM -- "-$command_pid" 2>/dev/null || true
    exit "$formatter_status"
} &
formatter_pid=$!

command_status=0
wait "$command_pid" || command_status=$?
formatter_status=0
wait "$formatter_pid" || formatter_status=$?

if [[ "$command_status" -ne 0 ]]; then
    exit "$command_status"
fi

if [[ "$formatter_status" -ne 0 ]]; then
    exit "$formatter_status"
fi

repository_directory="$(cd "$script_directory/.." && pwd)"
awk -v app_root="$repository_directory/app/" '
    /:[0-9]+(:[0-9]+)?: warning:/ {
        source = $0
        sub(/:[0-9]+(:[0-9]+)?: warning:.*/, "", source)
        if (source ~ /\/(\.build|SourcePackages)\//) next
        if (index(source, app_root) == 1 || source ~ /^(app\/)?(Modules|TCG)\//) {
            print > "/dev/stderr"
            warnings = 1
        }
    }
    END {
        if (warnings) print "Xcode emitted warnings in repository application sources." > "/dev/stderr"
        exit warnings ? 1 : 0
    }
' "$log_file"

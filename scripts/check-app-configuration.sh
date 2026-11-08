#!/usr/bin/env bash
set -euo pipefail

case "${TCG_API_ENVIRONMENT:-}" in
    remote)
        if [[ -z "${TCG_API_HOST:-}" ]]; then
            echo 'error: Create app/Configuration/Remote.local.xcconfig from Remote.example.xcconfig and set TCG_API_HOST to your API hostname.' >&2
            exit 1
        fi
        ;;
    local) ;;
    *) echo 'error: Select the TCG or TCG Local app configuration.' >&2; exit 1 ;;
esac
printf 'validated\n' > "${SCRIPT_OUTPUT_FILE_0:?Xcode must declare the configuration validation output}"

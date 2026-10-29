#!/usr/bin/env bash
set -euo pipefail

fail() {
    echo "$1" >&2
    exit 1
}

[[ "$(uname -s)" == Darwin ]] || fail 'Currency scheduling requires macOS.'
label=com.tcg.daily-currencies
service="system/$label"
plist="/Library/LaunchDaemons/$label.plist"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
action="${1:-}"

is_loaded() {
    local result
    if result="$(launchctl print "$service" 2>&1)"; then
        return 0
    fi
    [[ "$result" == *'Could not find service'* ]] || fail "Could not inspect the currency job: $result"
    return 1
}

case "$action" in
    status)
        [[ $# == 1 ]] || fail 'Usage: just currency-schedule-status'
        exec launchctl print "$service"
        ;;
    uninstall)
        [[ $# == 1 ]] || fail 'Usage: just uninstall-currency-schedule'
        if is_loaded; then
            sudo /bin/launchctl bootout "$service"
        fi
        sudo /bin/rm -f "$plist"
        echo 'Removed the currency job; environment file and logs were preserved.'
        exit 0
        ;;
    install|preview)
        [[ $# == 2 ]] || fail 'Provide an explicit environment file path.'
        [[ "$(id -u)" != 0 ]] || fail 'Run as your regular user; this script invokes sudo for system operations.'
        node_binary=node
        ;;
    run)
        [[ $# == 3 ]] || fail 'The scheduled runner requires an environment file and absolute Node executable.'
        node_binary="$3"
        [[ "$node_binary" == /* && -x "$node_binary" ]] || fail 'An absolute, executable Node path is required.'
        ;;
    *) fail 'Usage: currency-schedule.sh install|preview ENV_FILE, or status|uninstall' ;;
esac

[[ -f "$2" && -r "$2" ]] || fail 'The environment file must be a readable regular file.'
env_file="$(cd "$(dirname "$2")" && pwd -P)/$(basename "$2")"

# Validate with the existing schema and pin the resolved Node executable for launchd.
node_binary="$("$node_binary" "$repo_root/scripts/validate-currency-schedule.ts" "$env_file" "$action")"

if [[ "$action" == run ]]; then
    if [[ "$(TZ=Europe/Berlin date +%H%M)" < 1715 ]]; then
        echo 'Skipped early wake-up collection; waiting for 17:15 Frankfurt time.'
        exit 0
    fi
    cd "$repo_root/server"
    exec /usr/bin/env -i HOME="$HOME" NODE_ENV=production "$node_binary" \
        --env-file="$env_file" scripts/fetch-daily-currencies.ts
fi

xml_string() {
    printf '%s' "$1" | sed -e 's/\&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

render_plist() {
    cat <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
    <key>Label</key><string>$label</string>
    <key>UserName</key><string>$(xml_string "$(id -un)")</string>
    <key>WorkingDirectory</key><string>$(xml_string "$repo_root/server")</string>
    <key>ProgramArguments</key><array>
        <string>/usr/bin/env</string><string>-i</string>
        <string>$(xml_string "HOME=$HOME")</string><string>PATH=/usr/bin:/bin</string>
        <string>/bin/bash</string><string>$(xml_string "$repo_root/scripts/currency-schedule.sh")</string>
        <string>run</string><string>$(xml_string "$env_file")</string><string>$(xml_string "$node_binary")</string>
    </array>
    <key>StartCalendarInterval</key><dict><key>Hour</key><integer>17</integer><key>Minute</key><integer>15</integer></dict>
    <key>StandardOutPath</key><string>$(xml_string "$HOME/Library/Logs/TCG/currencies.stdout.log")</string>
    <key>StandardErrorPath</key><string>$(xml_string "$HOME/Library/Logs/TCG/currencies.stderr.log")</string>
    <key>Umask</key><integer>63</integer>
</dict></plist>
XML
}

if [[ "$action" == preview ]]; then
    render_plist
    exit 0
fi

umask 077
mkdir -p "$HOME/Library/Logs/TCG"
touch "$HOME/Library/Logs/TCG/currencies.stdout.log" "$HOME/Library/Logs/TCG/currencies.stderr.log"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
render_plist > "$temporary/$label.plist"
plutil -lint "$temporary/$label.plist"
if is_loaded; then
    sudo /bin/launchctl bootout "$service"
fi
sudo /usr/bin/install -o root -g wheel -m 644 "$temporary/$label.plist" "$plist"
sudo /bin/launchctl enable "$service"
sudo /bin/launchctl bootstrap system "$plist"
echo 'Installed daily currency collection at 17:15 Mac local time. No collection was started.'

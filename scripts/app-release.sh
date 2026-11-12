#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="${TCG_CONFIG_DIRECTORY:-$HOME/.config/tcg}"
mode="${1:-help}"
platform="${2:-}"
shift "$(( $# >= 2 ? 2 : $# ))"
revision=origin/main
archive=""

usage() {
    cat <<'USAGE'
Usage: just release-ios [REVISION] [--config-dir DIRECTORY]
       just release-macos [REVISION] [--config-dir DIRECTORY]
       just archive-ios [REVISION] [--config-dir DIRECTORY]
       just archive-macos [REVISION] [--config-dir DIRECTORY]
       just upload-ios ARCHIVE [--config-dir DIRECTORY]
       just upload-macos ARCHIVE [--config-dir DIRECTORY]
       just logs-app-release [ios|macos] [--config-dir DIRECTORY]

Default source: origin/main. Settings: $HOME/.config/tcg.
Release runs archive, signing, local export and upload without tests or confirmation prompts.
Xcode archives and exports locally; xcrun altool uploads using private email/password settings.
Logs use tail -n 100 -F. Ctrl-C stops the viewer, not the release.
USAGE
}

die() { printf '%s\n' "$1" >&2; exit "${2:-1}"; }
read_value() { plutil -extract "$2" raw -o - "$1"; }
stage=checks
note() {
    if [[ -n "${log:-}" ]]; then
        printf '\n[%s] %s\n' "$(date -u '+%H:%M:%S')" "$*" | tee -a "$log"
    else
        printf '\n[%s] %s\n' "$(date -u '+%H:%M:%S')" "$*"
    fi
    if [[ "${TCG_APP_PORTAL_EVENTS:-}" == 1 ]]; then
        printf 'TCG_APP_EVENT\t%s\t%s\n' "$stage" "$*"
    fi
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h) usage; exit 0 ;;
        --config-dir) [[ $# -ge 2 && -n "$2" ]] || die '--config-dir needs a directory.' 64; config="$2"; shift 2 ;;
        --*) die "Unknown option: $1" 64 ;;
        *)
            if [[ "$mode" == upload || "$mode" == inspect ]]; then
                [[ -z "$archive" ]] || die 'Specify one archive.' 64
                archive="$1"
            elif [[ "$mode" == logs ]]; then
                [[ -z "$platform" ]] || die 'Specify one platform.' 64
                platform="$1"
            else
                [[ "$revision" == origin/main ]] || die 'Specify one revision.' 64
                revision="$1"
            fi
            shift ;;
    esac
done

case "$config" in '~') config="$HOME" ;; '~/'*) config="$HOME/${config:2}" ;; esac
[[ "$config" == /* ]] || config="$PWD/$config"
if [[ "$mode" == help || "$platform" == --help ]]; then usage; exit 0; fi
if [[ "$mode" == logs ]]; then
    [[ -z "$platform" || "$platform" == ios || "$platform" == macos ]] || die 'Platform must be ios or macos.' 64
    latest=""
    for log in "$config"/app-releases/*/release.log; do
        [[ -f "$log" ]] || continue
        [[ -z "$platform" || "$(basename "$(dirname "$log")")" == "$platform"-* ]] || continue
        if [[ -z "$latest" || "$log" -nt "$latest" ]]; then latest="$log"; fi
    done
    [[ -n "$latest" ]] || die 'No app release log found. Start a release, then run just logs-app-release in another tab.'
    printf 'Following %s. Press Ctrl-C to stop watching.\n' "$latest" >&2
    exec tail -n 100 -F "$latest"
fi

[[ "$platform" == ios || "$platform" == macos ]] || die 'Platform must be ios or macos.' 64
[[ "$mode" == release || "$mode" == archive || "$mode" == upload || "$mode" == inspect ]] || die 'Unknown app release action.' 64
[[ "$(uname -s)" == Darwin ]] || die 'App releases require macOS and Xcode.'
settings="$config/app-release.json"
[[ -r "$settings" ]] || die 'Run just setup-app-release first.'
[[ "$(read_value "$settings" version)" == 1 ]] || die 'Unsupported app release settings.'
team="$(read_value "$settings" teamID)"
host="$(read_value "$settings" apiHost)"
[[ "$team" =~ ^[A-Z0-9]{10}$ ]] || die 'Invalid signing team in app release settings.'
[[ ${#host} -le 253 && "$host" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ && "$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')" != api.example.com && "$host" != *.[Ll][Oo][Cc][Aa][Ll][Hh][Oo][Ss][Tt] ]] || die 'Invalid API hostname in app release settings.'

upload_email=""
upload_password=""
if [[ "$mode" == release || "$mode" == upload ]]; then
    credentials="$config/app-store-connect.json"
    [[ -r "$credentials" ]] || die 'Run just setup-app-release once to save your App Store Connect email and app-specific password privately.'
    upload_email="$(read_value "$credentials" email 2>/dev/null)" || die 'Run just setup-app-release to save your private upload email and app-specific password.'
    upload_password="$(read_value "$credentials" password 2>/dev/null)" || die 'Run just setup-app-release to save your private upload email and app-specific password.'
    [[ "$upload_email" == *@* && "$upload_password" =~ ^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$ ]] || die 'Invalid upload credentials. Run just setup-app-release --edit.'
fi

inspect_archive() {
    local app_path app info supported
    app_path="$(read_value "$archive/Info.plist" ApplicationProperties.ApplicationPath)"
    [[ "$app_path" == Applications/*.app && "$app_path" != *..* ]] || die 'Unexpected application path in archive.'
    app="$archive/Products/$app_path"
    info="$app/Info.plist"
    [[ "$platform" != macos ]] || info="$app/Contents/Info.plist"
    [[ "$(read_value "$info" CFBundleIdentifier)" == io.kamaal.TCG ]] || die 'Archive bundle identifier does not match.'
    [[ "$(read_value "$info" CFBundleShortVersionString)" == "$version" ]] || die 'Archive version does not match.'
    [[ "$(read_value "$info" TCGAPIBaseURL)" == "https://$host" ]] || die 'Archive production endpoint does not match.'
    [[ "$(read_value "$info" TCGAPIEnvironment)" == remote ]] || die 'Archive is not configured for production.'
    supported=iPhoneOS
    [[ "$platform" != macos ]] || supported=MacOSX
    [[ "$(read_value "$info" CFBundleSupportedPlatforms.0)" == "$supported" ]] || die 'Archive platform does not match.'
    codesign --verify --deep --strict "$app"
    codesign --verify -R "=anchor apple generic and certificate leaf[subject.OU] = \"$team\"" "$app"
}

if [[ "$mode" == inspect ]]; then
    [[ -d "$archive" ]] || die 'Specify an existing .xcarchive directory.' 64
    version="$(read_value "$archive/Info.plist" ApplicationProperties.CFBundleShortVersionString)"
    inspect_archive
    note 'Archive metadata and signatures are valid.'
    exit 0
fi

mkdir -p "$config/app-releases"
chmod 700 "$config/app-releases"
lock="$config/app-release.lock"
owns_lock=0
owns_reclaim=0
checkout=""
summary_state=failed
session=""
sha=""
fingerprint=""
child=""
ticker=""
tee_pid=""
awake_pid=""

descendants() {
    local pid
    for pid in $(pgrep -P "$1" 2>/dev/null || true); do descendants "$pid"; printf '%s\n' "$pid"; done
}

terminate_step() {
    [[ -n "$child" ]] || return 0
    local pids
    pids="$(descendants "$child") $child"
    # Only the current command's process tree is targeted; Xcode.app is not a descendant.
    kill -TERM $pids 2>/dev/null || true
    for _ in 1 2 3 4 5; do kill -0 "$child" 2>/dev/null || break; sleep 1; done
    kill -KILL $pids 2>/dev/null || true
}

save_summary() {
    [[ -n "$sha" && -n "$fingerprint" ]] || return 0
    printf '{"platform":"%s","sha":"%s","fingerprint":"%s","state":"%s","createdAt":"%s"}\n' \
        "$platform" "$sha" "$fingerprint" "$summary_state" "$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')" > "$session/summary.tmp"
    mv "$session/summary.tmp" "$session/summary.json"
}

stop_ticker() {
    if [[ -n "$ticker" ]]; then
        pkill -TERM -P "$ticker" 2>/dev/null || true
        kill "$ticker" 2>/dev/null || true
        wait "$ticker" 2>/dev/null || true
        ticker=""
    fi
}

cleanup() {
    local status=$?
    trap - EXIT INT TERM
    unset TCG_APP_STORE_PASSWORD
    stop_ticker
    if [[ -n "$child" ]]; then
        terminate_step
        wait "$child" 2>/dev/null || true
    fi
    if [[ -n "$tee_pid" ]]; then wait "$tee_pid" 2>/dev/null || true; fi
    if [[ "$status" != 0 && "$summary_state" != uploaded ]]; then summary_state=failed; fi
    if [[ -n "$session" ]]; then save_summary; fi
    if [[ -n "$checkout" ]]; then
        note 'Cleaning up isolated release source'
        cd "$root"
        git -C "$root" worktree remove --force "$checkout" >> "$log" 2>&1 || true
        note 'Completed: Cleaning up isolated release source'
    fi
    if [[ -n "$awake_pid" ]]; then
        kill "$awake_pid" 2>/dev/null || true
        wait "$awake_pid" 2>/dev/null || true
    fi
    if [[ "$owns_lock" == 1 ]]; then rm -rf "$lock"; fi
    if [[ "$owns_reclaim" == 1 ]]; then rmdir "$lock.reclaim"; fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "${TCG_APP_LEASE_PID:-}" == "$PPID" && "$(cat "$lock/pid" 2>/dev/null || true)" == "$PPID" ]]; then
    : # Devportal owns the same lease until this script and its output have exited.
else
    [[ ! -d "$lock.reclaim" ]] || die 'Another process is reclaiming the app release lease.'
    if ! mkdir "$lock" 2>/dev/null; then
        old_pid="$(cat "$lock/pid" 2>/dev/null || true)"
        [[ "$old_pid" =~ ^[0-9]+$ ]] || die 'An app release lease already exists.'
        if kill -0 "$old_pid" 2>/dev/null; then die 'Another app release is running on this Mac.'; fi
        mkdir "$lock.reclaim" 2>/dev/null || die 'Another process is reclaiming the app release lease.'
        owns_reclaim=1
        [[ "$(cat "$lock/pid" 2>/dev/null || true)" == "$old_pid" ]] || die 'The app release lease changed.'
        rm -rf "$lock"
        mkdir "$lock"
        rmdir "$lock.reclaim"
        owns_reclaim=0
    fi
    owns_lock=1
    printf '%s' "$$" > "$lock/pid"
fi

if [[ "$mode" == upload ]]; then
    [[ -d "$archive" ]] || die 'Specify an existing .xcarchive directory.' 64
    session="$(cd "$(dirname "$archive")" && pwd)"
    archive="$session/$(basename "$archive")"
    sha="$(read_value "$session/summary.json" sha)"
    [[ "$sha" =~ ^[a-f0-9]{40}$ ]] || die 'Archive release history has an invalid commit.'
    version="$(read_value "$archive/Info.plist" ApplicationProperties.CFBundleShortVersionString)"
else
    session="$(mktemp -d "$config/app-releases/$platform-XXXXXX")"
fi
log="$session/release.log"
touch "$log"
chmod 600 "$log"
note "Release log: $log"
if [[ "$mode" == release ]]; then
    note "Release $platform: archive → sign → inspect → export → upload"
fi
note 'Signing: Xcode automatic signing. Upload: separate Apple CLI with private credentials.'

wait_for_signing_session() {
    local locked console_uid announced=0 last_notice=$SECONDS assertion_deadline
    while true; do
        locked="$(ioreg -a -n Root -d1 | plutil -extract IOConsoleLocked raw -o - -)" || die 'Cannot check the release Mac lock state. No signing command was started.'
        [[ "$locked" == true || "$locked" == false ]] || die 'Unknown release Mac lock state. No signing command was started.'
        console_uid="$(stat -f %u /dev/console)"
        if [[ "$locked" == false && "$console_uid" == "$(id -u)" ]]; then break; fi
        if [[ "$announced" == 0 || $(( SECONDS - last_notice )) -ge 30 ]]; then
            note 'Waiting for the release Mac to be unlocked. Xcode signing has not started; Ctrl-C cancels safely.'
            announced=1
            last_notice=$SECONDS
        fi
        sleep 2
    done
    if [[ -z "$awake_pid" ]]; then
        caffeinate -di -w "$$" </dev/null >/dev/null 2>&1 &
        awake_pid=$!
        assertion_deadline=$(( SECONDS + 5 ))
        until pmset -g assertions | awk -v marker="pid $awake_pid(" '
            index($0, marker) {
                if ($0 ~ /PreventUserIdleDisplaySleep/) display_awake = 1
                if ($0 ~ /PreventUserIdleSystemSleep/) system_awake = 1
            }
            END { exit !(display_awake && system_awake) }
        '; do
            kill -0 "$awake_pid" 2>/dev/null || die 'The temporary awake assertion failed. No signing command was started.'
            (( SECONDS < assertion_deadline )) || die 'The temporary awake assertion did not become active. No signing command was started.'
            sleep 0.1
        done
        note 'Keeping the release Mac display and system awake until this release ends.'
    fi
    if [[ "$announced" == 1 ]]; then note 'Release Mac unlocked; continuing signing.'; fi
}

redact_upload_output() {
    local line
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line//"$upload_email"/[private email]}"
        line="${line//"$upload_password"/[private password]}"
        printf '%s\n' "$line"
    done
}

run() {
    local label="$1" started=$SECONDS status now last formatted=0
    shift
    note "Starting: $label"
    if [[ "$1" == xcodebuild ]]; then wait_for_signing_session; fi
    # Retain stdin and the terminal security context; no detached process/session wrapper.
    rm -f "$session/.command.pipe" "$session/.timed-out"
    mkfifo "$session/.command.pipe"
    : > "$session/.command.log"
    if [[ "$1" == xcrun && "${2:-}" == altool ]]; then
        redact_upload_output < "$session/.command.pipe" | tee -a "$log" "$session/.command.log" &
    elif [[ "$1" == xcodebuild && "${TCG_XCODE_RAW_OUTPUT:-}" != 1 ]] && command -v xcbeautify >/dev/null; then
        formatted=1
        tee -a "$log" "$session/.command.log" < "$session/.command.pipe" | {
            bash "$root/scripts/run-with-xcbeautify.sh" --stdin || printf 'Xcode output formatting stopped; raw output remains in %s.\n' "$log" >&2
            # Drain remaining output even if the formatter exits early.
            cat
        } &
    else
        tee -a "$log" "$session/.command.log" < "$session/.command.pipe" &
    fi
    tee_pid=$!
    {
        printf '+ '
        for argument in "$@"; do
            if [[ -n "$upload_email" && "$argument" == "$upload_email" ]]; then printf '%s ' '[private email]'; else printf '%q ' "$argument"; fi
        done
        printf '\n'
    } | tee -a "$log"
    "$@" <&0 > "$session/.command.pipe" 2>&1 &
    child=$!
    (
        while sleep 30; do
            now="$(date +%s)"
            last="$(stat -f %m "$session/.command.log")"
            note "$label: $(( SECONDS - started ))s elapsed; no tool output for $(( now - last ))s."
            if (( now - last >= 600 )); then
                touch "$session/.timed-out"
                note 'Stopping command after ten minutes without tool output.'
                terminate_step
                break
            fi
        done
    ) 2>/dev/null &
    ticker=$!
    if wait "$child"; then status=0; else status=$?; fi
    wait "$tee_pid" || true
    tee_pid=""
    stop_ticker
    child=""
    rm -f "$session/.command.pipe"
    [[ ! -e "$session/.timed-out" ]] || status=124
    if [[ "$status" != 0 ]]; then
        if [[ "$formatted" == 1 ]]; then
            printf '\nLast raw Xcode diagnostics:\n'
            tail -n 100 "$session/.command.log"
        fi
        note "Stopped: $label (exit $status). Full log: $log"
        return "$status"
    fi
    note "Completed: $label ($(( SECONDS - started ))s)"
}

if [[ "$mode" != upload ]]; then
    run 'Fetch merged source' git -C "$root" fetch origin main
    sha="$(git -C "$root" rev-parse --verify --end-of-options "$revision^{commit}")"
    [[ "$sha" =~ ^[a-f0-9]{40}$ ]] || die 'Invalid release commit.'
    git -C "$root" merge-base --is-ancestor "$sha" origin/main || die 'Release source must already be merged into main.'
    version="$(git -C "$root" show "$sha:app/Configuration/App.xcconfig" | sed -n 's/^MARKETING_VERSION[[:space:]]*=[[:space:]]*\([0-9.]*\)[[:space:]]*$/\1/p')"
    [[ "$version" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || die 'Invalid app marketing version.'
fi
candidate_fingerprint="$(printf '["%s","%s",{"version":1,"teamID":"%s","apiHost":"%s"}]' "$platform" "$sha" "$team" "$host" | shasum -a 256 | awk '{print $1}')"
if [[ "$mode" == upload ]]; then
    [[ "$(read_value "$session/summary.json" fingerprint)" == "$candidate_fingerprint" ]] || die 'Archive settings differ from the current release settings. Restore the original team and API hostname before uploading.'
    [[ "$(read_value "$session/summary.json" platform)" == "$platform" ]] || die 'Archive release history has a different platform.'
fi
fingerprint="$candidate_fingerprint"
[[ -z "${TCG_APP_REVIEWED_FINGERPRINT:-}" || "$TCG_APP_REVIEWED_FINGERPRINT" == "$fingerprint" ]] || die 'Release settings changed; refresh and review again.'
for record in "$config"/app-releases/*/summary.json; do
    [[ -f "$record" ]] || continue
    if [[ "$(read_value "$record" state)" == uploaded && "$(read_value "$record" fingerprint)" == "$fingerprint" ]]; then
        die 'This source and app configuration were already uploaded.'
    fi
done

if [[ "$mode" != upload ]]; then
    summary_state=started
    save_summary
    checkout="$session/source"
    run 'Prepare source' git -C "$root" worktree add --detach "$checkout" "$sha"
    build_number="$(git -C "$root" rev-list --count "$sha")"
    archive="$session/Mintomo.xcarchive"
    destination='generic/platform=iOS'
    [[ "$platform" != macos ]] || destination='generic/platform=macOS'
    stage=archive
    cd "$checkout"
    run "Archive and sign $platform" xcodebuild -project app/TCG.xcodeproj -scheme TCG -configuration Release \
        -destination "$destination" -archivePath "$archive" archive \
        CODE_SIGN_STYLE=Automatic CODE_SIGNING_ALLOWED=YES "DEVELOPMENT_TEAM=$team" "TCG_API_HOST=$host" \
        ONLY_ACTIVE_ARCH=NO SWIFT_USE_INTEGRATED_DRIVER=NO "CURRENT_PROJECT_VERSION=$build_number" -allowProvisioningUpdates
fi
run 'Inspect archive' inspect_archive
if [[ "$mode" == archive ]]; then note "Archive ready: $archive"; exit 0; fi

stage=archive
cat > "$session/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string>
<key>signingStyle</key><string>automatic</string>
<key>teamID</key><string>$team</string>
<key>manageAppVersionAndBuildNumber</key><false/>
<key>uploadSymbols</key><true/>
</dict></plist>
PLIST
run 'Export signed app locally' xcodebuild -exportArchive -archivePath "$archive" \
    -exportOptionsPlist "$session/ExportOptions.plist" -exportPath "$session/export" -allowProvisioningUpdates
extension=ipa
[[ "$platform" != macos ]] || extension=pkg
packages=("$session/export/"*."$extension")
[[ ${#packages[@]} == 1 && -f "${packages[0]}" ]] || die 'Xcode did not export exactly one upload package. See the private release log.'
stage=upload
summary_state=uploading
save_summary
export TCG_APP_STORE_PASSWORD="$upload_password"
if run 'Upload to App Store Connect' xcrun altool --upload-app -t "$platform" -f "${packages[0]}" \
    -u "$upload_email" -p @env:TCG_APP_STORE_PASSWORD; then
    unset TCG_APP_STORE_PASSWORD
    summary_state=uploaded
    note 'Uploaded to App Store Connect; processing pending.'
else
    status=$?
    unset TCG_APP_STORE_PASSWORD
    summary_state=failed
    note 'Apple upload stopped. Check App Store Connect before retrying; no automatic retry was made.'
    exit "$status"
fi

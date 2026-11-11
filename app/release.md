# Release Mintomo

[App guide](README.md) · [Devportal](../devportal/README.md)

App releases run on the release Mac, using its Xcode account and Keychain for
automatic signing. Both iOS and macOS builds upload to App Store Connect.
Uploading does not distribute to testers or submit an app for review.

## One-time setup

Sign into Xcode **Settings → Accounts** with your Apple Developer account. Check
that the account has access to your team, signing assets and App Store Connect
uploads. Accept outstanding agreements and create the app record for bundle ID
`io.kamaal.TCG`, with iOS and macOS platforms enabled.

```sh
just setup-app-release
```

The wizard reuses known values and shows a summary before saving. It uses saved
app-release settings first, then the infrastructure's `configuration.api_hostname`
from local Terraform settings, then the private app configuration. From a linked
worktree, it also reads the primary checkout’s private files; you do not need to
copy them into each worktree. Current-checkout values take precedence within
each source type. The signing
team comes from saved settings or the Xcode project. Only missing or invalid
values require typing; reading infrastructure settings never applies changes.
Use `just setup-app-release --edit` when you want to change reused values.
A release opens this wizard automatically when setup is missing.
No Apple password or API key is collected. Private settings live in
`$HOME/.config/tcg/app-release.json`, with directory mode 0700 and file mode 0600.
Use `--config-dir` to select another private settings directory.

Keep the release user logged in, the Mac awake, and Keychain unlocked. The
Devportal LaunchAgent must run as that same user. If Xcode or Keychain needs a
local authorization prompt, complete it on the Mac before retrying.

## Terminal release

Merge the changes into main, then run from the repository root:

```sh
just release-ios
just release-macos
```

Both commands fetch main and pin the exact commit. An optional revision must
already be merged into main. They create an isolated checkout and archive only
the selected platform. Release commands assume the selected source was already
verified: they do not install Node dependencies or run quality checks, tests,
simulators, or localization verification. Run `just ready-app` separately when
needed, before releasing. The caller's checkout and private remote configuration
remain unchanged. The saved hostname is passed to
the release build explicitly.

Review the platform, commit, version, team, bundle ID and HTTPS endpoint. Approve
archive/signing; Xcode may create or update certificates, identifiers and profiles.
After archive verification, a separate approval uploads the app. The marketing
version comes from the selected commit's `App.xcconfig`; change it in a merged PR
when starting a new store version. Xcode manages the upload build number, so the
archive's initial build number may differ from the uploaded build number.

Success means **Uploaded to App Store Connect; processing pending**. Check
[App Store Connect](https://appstoreconnect.apple.com) for the final build number,
processing result, export compliance questions, tester distribution and App Review.
The recipes do not poll Apple processing status.

## Devportal release

After merging this capability, update the release service with
`just install-devportal-agent`. Set up app releases on that same Mac and in the
same settings directory. Open Mintomo Devportal and choose **iOS release** or
**macOS release** from **Release destination**. Review the selected main commit,
then start the release and approve signing and upload separately.

All existing allowed Devportal operators can release all three destinations.
No signing credentials leave the Mac. Missing app setup blocks app releases while
server releases remain available. App progress and approvals survive closing the
client; reconnect to continue. Upload history is independent for each platform
and records uploads, not published App Store versions.

## Failures and retries

Releases announce each milestone as it starts, completes or stops: inspecting
source, preparing the checkout, archiving and signing, archive validation, upload,
and cleanup. An active milestone reports
its name, elapsed time and time since the last tool output every 30 seconds.
CLI releases also stream the command and its stdout and stderr as they arrive.
Devportal retains the same milestones and elapsed updates in session history;
raw tool output stays private on the release Mac.

First archives can take several minutes to build Swift dependencies. Milestones
report completed work, without estimating a percentage or claiming that
App Store Connect has finished processing the uploaded build.

To watch the latest app release from another terminal tab:

```sh
just logs-app-release
# Or select a platform or a different private settings directory:
just logs-app-release ios
just logs-app-release macos --config-dir "$HOME/.config/tcg"
```

This uses the system `tail -n 100 -F` command to show recent output and follow
new lines. It selects the most recently updated session log when started and
keeps following that file; rerun it to watch a newer release. Ctrl-C stops the
viewer and leaves the release running.

A failed CLI command prints its command name, exit status and captured diagnostic
output directly. Large output is bounded; the complete output remains in the
private log. Upload uncertainty guidance appears only when the upload command
was attempted. Devportal reports the failed stage and keeps raw host diagnostics
on the Mac.

An archive uses the separate Swift compiler driver to avoid the in-process
driver dependency-planning stall observed on the release Mac. A command with no
tool output for ten minutes is stopped with an idle-timeout error (exit 124),
retaining its diagnostics. Uploads are never retried automatically.

Detailed logs, archives, export settings and session summaries are private under
`$HOME/.config/tcg/app-releases`. Devportal session history remains under
`$HOME/.config/tcg/devportal-releases`. The two app destinations and terminal
commands share an app-release lease. Service updates and uninstall refuse to
interrupt either an app or server release.

Fix signing failures in Xcode Accounts or Keychain on the release Mac. Failed
archives and declined approvals never proceed to upload. Settings changed during
approval require a new review. A completed identical upload is rejected; select
a new merged commit for another build.

There is no automatic upload retry. If upload failed or the service restarted,
check App Store Connect first: Apple may have received the build before the local
command lost its result. Retry explicitly only after checking. Retained archives
and logs aid diagnosis; a retry builds a fresh archive and uses Xcode-managed
numbering. Never remove a lease while its commands are still running.

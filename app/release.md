# Release Mintomo

[App guide](README.md) · [Devportal](../devportal/README.md)

Run `just release-ios` or `just release-macos` on the release Mac. Each calls the
same shell pipeline used by Devportal: archive, sign, inspect, then upload to
App Store Connect. There are no confirmation questions or release-time tests.
Uploading does not distribute to testers or submit for App Review.

## One-time setup

Install Xcode and accept its license. Accept outstanding Apple agreements and
create the app record for `io.kamaal.TCG`, with iOS and macOS platforms enabled.
Keep the release user logged in, the Mac awake and signing Keychain unlocked.
Devportal's LaunchAgent must run as the same user.

Sign into **Xcode Settings → Accounts** with your Apple Developer account, with
access to signing assets and App Store Connect for the saved team. Then run:

```sh
just setup-app-release
```

The wizard reuses the saved team and API hostname. If missing, the team comes
from the Xcode project; the hostname comes from the infrastructure's
`configuration.api_hostname`, then the private app configuration. Linked worktrees
also read the primary checkout's private files. It asks only for missing values.
Use `--edit` to change them. Default setup does not ask for API keys or passwords.

Automatic signing and uploads use the account already signed into Xcode.
The commands pass `-allowProvisioningUpdates` for both archiving and uploading,
allowing Xcode to create or update certificates and profiles. The scripts do not
delete, reset or rewrite Xcode accounts, preferences or Keychain credentials.
Xcode’s command-line tools use its stored account credentials. Apple failures
are streamed directly and the archive is retained.

An API key is optional for machines configured to use one:

```sh
just setup-app-release --api-key
```

This explicitly configures a team key's existing `.p8` path, Key ID (inferred
from `AuthKey_KEYID.p8`) and Issuer ID. When
`$HOME/.config/tcg/app-store-connect.json` exists, its credentials are passed to
Xcode instead of using the account session. Invalid existing key settings fail
with their error rather than silently changing authentication methods.
Ordinary setup preserves any existing key settings.

Release settings live in `$HOME/.config/tcg/app-release.json`; optional key
metadata lives in `app-store-connect.json` in the same directory. Directory mode
is 0700 and settings files use 0600. The key stays in its original file; its
contents and Apple passwords are never copied into settings, logs or Devportal.
`--config-dir` selects another private settings directory.

## Terminal release

Merge and verify the changes, then run from the repository root:

```sh
just release-ios
just release-macos
# Optional: a specific commit already merged into main
just release-ios origin/main
```

Both commands fetch main, pin the commit and use an isolated source checkout.
Only the selected platform is archived. They do not install Node dependencies,
run tests, start simulators or run quality/localization checks. Run
`just ready-app` separately before releasing when needed. The terminal pipeline
is `scripts/app-release.sh`; it uses Bash, Git and native macOS/Xcode tools.
TypeScript remains in the existing configuration wizard and Devportal bridge.

The saved production hostname is passed directly into the build. The marketing
version comes from that commit's `App.xcconfig`; change it in a merged PR for a
new store version. Xcode manages the uploaded build number. Archive inspection
checks the platform, bundle ID, version, endpoint and signing team.

To archive with automatic signing without uploading:

```sh
just archive-ios
just archive-macos
```

After fixing an upload failure, reuse its retained archive without rebuilding:

```sh
just upload-ios "$HOME/.config/tcg/app-releases/ios-SESSION/Mintomo.xcarchive"
just upload-macos "$HOME/.config/tcg/app-releases/macos-SESSION/Mintomo.xcarchive"
```

Check App Store Connect before retrying an uncertain upload. Upload-only commands
check that the archive still matches the saved team, endpoint and platform.
A completed identical upload is rejected. There are no automatic upload retries.

Success means **Uploaded to App Store Connect; processing pending**. Check
[App Store Connect](https://appstoreconnect.apple.com) for processing, export
compliance, tester distribution and App Review. Recipes do not poll Apple processing.

## Devportal release

Update the service with `just install-devportal-agent` after merging. Run setup
on that Mac using the service's settings directory. Choose **iOS release** or
**macOS release** from **Release destination**, review the selected main commit,
then start the release. Starting authorizes signing and upload; there are no
additional app-release approvals.

All allowed operators can release any destination. Signing credentials stay on
the Mac. Missing app setup blocks app releases while server releases remain
available. Closing the client does not stop the job; reconnect for progress.
Upload history is separate for each platform and records uploads, not App Store
publication. Server release approvals are unchanged.

## Progress and failures

Each milestone announces its start, completion or failure: fetching source,
preparing the checkout, archiving/signing, inspecting the archive, uploading and
cleanup. Active commands report their name, elapsed time and time since the last
tool output every 30 seconds. The terminal streams the complete command output;
Devportal retains curated milestones while raw diagnostics stay on the Mac.

Watch output from another terminal tab:

```sh
just logs-app-release
just logs-app-release ios
just logs-app-release macos --config-dir "$HOME/.config/tcg"
```

This runs native `tail -n 100 -F` on the most recently updated matching session
log. It keeps following that file; rerun for a newer release. Ctrl-C stops only
the viewer.

First archives can take several minutes to compile dependencies. The separate
Swift compiler driver avoids the dependency-planning stall observed on the
release Mac. Ten minutes without tool output stops the current command with
exit 124. Cancelling stops its child processes and releases the app-release
lease. The caller's checkout is unchanged, and archives and logs are retained.

A failed command prints its output, milestone, exit status and full log path.
Known account-authentication failures report that transfer did not start;
other attempted upload failures ask you to check App Store Connect before retrying.
For account authentication failures, the Apple diagnostic identifies the problem
with Xcode’s stored credentials or account access. For optional API keys, check
the key’s permissions. Neither path automatically resets credentials or retries
an upload.

Private artifacts live under `$HOME/.config/tcg/app-releases`, and Devportal
history under `$HOME/.config/tcg/devportal-releases`. Terminal and Devportal app
releases share one lease. Service updates refuse to interrupt releases. Never
remove a lease while its commands are running.

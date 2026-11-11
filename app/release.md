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
already be merged into main. They create an isolated checkout, install locked
dependencies, and run `just ready-app` before archiving. The caller's checkout and
private remote configuration remain unchanged. The saved hostname is passed to
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

Detailed logs, archives, export settings and session summaries are private under
`$HOME/.config/tcg/app-releases`. Devportal session history remains under
`$HOME/.config/tcg/devportal-releases`. The two app destinations and terminal
commands share an app-release lease. Service updates and uninstall refuse to
interrupt either an app or server release.

Fix signing failures in Xcode Accounts or Keychain on the release Mac. Failed
checks and declined approvals never proceed to upload. Settings changed during
approval require a new review. A completed identical upload is rejected; select
a new merged commit for another build.

There is no automatic upload retry. If upload failed or the service restarted,
check App Store Connect first: Apple may have received the build before the local
command lost its result. Retry explicitly only after checking. Retained archives
and logs aid diagnosis; a retry builds a fresh archive and uses Xcode-managed
numbering. Never remove a lease while its commands are still running.

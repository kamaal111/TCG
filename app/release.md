# Release Mintomo

[App guide](README.md) · [Devportal](../devportal/README.md)

`just release-ios` and `just release-macos` run this sequence:

1. Archive and sign with `xcodebuild` using local distribution signing assets.
2. Inspect the archive's platform, identity, version and production endpoint.
3. Export a signed IPA or PKG locally with `xcodebuild -exportArchive`.
4. Upload that file with `xcrun altool` using private upload credentials.

Terminal and Devportal share the same shell pipeline. There are no release-time
tests, dependency installations or confirmation questions. XcTools is not used.

## One-time setup

Install Xcode and accept its license and outstanding Apple agreements. Create the
`io.kamaal.TCG` app record in App Store Connect with iOS and macOS platforms.
Create an **Apple Distribution** certificate in Xcode Settings → Accounts →
Manage Certificates, then export it with its private key as a password-protected
`.p12`. Download its matching **App Store Connect provisioning profile** for
`io.kamaal.TCG` from developer.apple.com. For macOS, also export a **Mac Installer
Distribution** certificate and private key. Cloud-managed certificates alone do
not provide the local private keys needed for unattended releases.

This is a one-time signing-assets setup, separate from upload authentication.
The recipes never reset Xcode accounts or your login Keychain.

```sh
just setup-app-release                     # iOS signing and shared upload settings
just setup-app-release --platform macos    # add macOS signing assets
```

Setup reuses the saved signing team and API hostname. If missing, the team comes
from the project, and the hostname from infrastructure's
`configuration.api_hostname`, then private app configuration. Linked worktrees
also read the primary checkout's private files.

Setup asks for your **App Store Connect email** and masked **app-specific
password**, then imports the selected platform's `.p12` and provisioning profile
into a separate private release keychain. It asks for the `.p12` password masked
and uses it only for import; it is not saved. For macOS it also imports the
installer signing identity. Existing valid signing and upload settings are reused.
Rerunning setup repairs the owned keychain access rules, search-list entry and
installed profile without asking for the signing files again when they remain valid.

Generate the upload password at [Apple Account](https://account.apple.com/)
under Sign-In and Security → App-Specific Passwords. Your main Apple Account
password is not accepted. Use `just setup-app-release --edit` to change saved
upload settings. Renew signing by supplying a current profile/certificate when
setup reports that the saved assets are expired or unusable.

Private files live under `$HOME/.config/tcg` (directory mode 0700):

- `app-release.json`: signing team and production hostname.
- `app-store-connect.json`: email and app-specific password (file mode 0600).
- `app-signing/`: distribution profiles, identity fingerprints, a separate release
  keychain, and its randomly generated password (private files mode 0600).

Setup adds only this keychain to the existing user signing search list, preserving
all entries. It configures noninteractive signing access only on this owned
keychain and installs the selected profile under Xcode's provisioning profiles
folder. It never deletes certificates or changes login-keychain access rules.

The upload credentials filename and `app-signing/` directory are ignored by Git
even with a custom `--config-dir`.
The upload command uses a password environment reference; credentials are
redacted from echoed commands and upload output. No email or password is sent
to Devportal clients. API keys are not needed.

## Release commands

Merge and verify source, then run:

```sh
just release-ios
just release-macos
# Optionally choose a commit already merged into main:
just release-ios origin/main
```

The commands fetch main, pin the selected commit and use an isolated source
checkout. Only the selected platform is built. Run `just ready-app` separately
before releasing when needed. The saved production hostname is passed into the
build; the caller's checkout and private app configuration are unchanged.

The marketing version comes from the selected commit's `App.xcconfig`.
New archives use that commit's Git commit count as their build number; a new
merged commit produces a new build number. Local export preserves this number,
and upload-only retries keep it. Older retained archives keep their original
build number; build a fresh archive if Apple has already received that number.

Archive without uploading:

```sh
just archive-ios
just archive-macos
```

Reuse a retained archive without recompiling:

```sh
just upload-ios "$HOME/.config/tcg/app-releases/ios-SESSION/Mintomo.xcarchive"
just upload-macos "$HOME/.config/tcg/app-releases/macos-SESSION/Mintomo.xcarchive"
```

Upload-only still inspects and locally exports the archive. Its platform, team
and production endpoint must match the saved settings. Successful identical
uploads are rejected. Uploads are never retried automatically.

The final success message includes the platform, app version and build number
read from the signed archive, including when uploading a retained archive.
For example: `Release complete: ios version 1.0 (build 123).`

Success means **Uploaded to App Store Connect; processing pending**. Check
[App Store Connect](https://appstoreconnect.apple.com) for processing, export
compliance, tester distribution and App Review. These recipes do not submit
for review or poll processing status.

## Remote releases and progress

Releases can run over SSH or Devportal with the display locked. The recipe does
not inspect screen-lock state or require an active console user. A temporary
`caffeinate -i` process requests prevention of idle system sleep until the release
ends, without keeping the display awake or changing screen-lock preferences.
Failure to start this helper does not block signing or upload.

Each release unlocks only the private release keychain. It checks the profile's
platform, team, app identifier, expiry and matching usable private key before
building, and probes local signing access using a temporary executable. It then
archives and exports with manual signing, explicit identities/profile UUIDs, and
**no `-allowProvisioningUpdates`**. There is no automatic/cloud-signing fallback.
Private app-specific credentials handle upload separately.

A missing/expired profile or private key stops before compilation with setup
instructions. Xcode/Apple failures retain their original diagnostics and archive.
The upload-only recipe can export and upload an earlier retained archive after
local signing setup; recompilation is unnecessary.

Each milestone reports its start, completion or failure. Active commands report
elapsed time and time since the last raw tool output every 30 seconds. First
archives can spend several minutes compiling dependencies. A command with no
output for ten minutes stops with exit 124 and retains its log and archive.

Xcode output is pretty-printed with the existing `xcbeautify` renderer when
installed. Formatting does not add test or warning gates. Raw output remains
in the private release log, and the last raw diagnostics are printed if Xcode
fails. `TCG_XCODE_RAW_OUTPUT=1 just release-ios` shows raw output directly.
A missing or failed formatter does not block the release or replace Apple's
exit code. Inactivity is measured from raw output, not formatted output.

Watch the complete log from another terminal tab:

```sh
just logs-app-release
just logs-app-release ios
just logs-app-release macos --config-dir "$HOME/.config/tcg"
```

This uses native `tail -n 100 -F` on the latest matching session log. It keeps
following that file; restart the viewer for a newer release. Ctrl-C stops only
the viewer.

## Devportal and failure recovery

Update the service with `just install-devportal-agent` after merging, and run
setup on that Mac using its settings directory. Select iOS or macOS, review the
main commit, then start the release. Starting authorizes archive, signing, local
export and upload without further app approvals. Server approvals are unchanged.

All allowed operators can release any destination. Closing the client does not
stop the job; reconnect for curated progress messages. Raw tool output remains
private on the release Mac. Missing upload setup blocks app releases while
server releases remain available.

A failed command retains its exit code and diagnostic output. Local export
failures occur before upload. If the upload is interrupted, check App Store
Connect before retrying because Apple may have received the file. Failed uploads
can reuse the retained archive without compilation.

Private artifacts live under `$HOME/.config/tcg/app-releases`; Devportal history
is under `$HOME/.config/tcg/devportal-releases`. Terminal and Devportal app
releases share one lease, and service updates refuse to interrupt releases.
Never remove a lease while its commands are running.

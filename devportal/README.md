# Mintomo Devportal service

The native **Mintomo Devportal** target in `app/` connects to this private Hono
service on the release Mac mini. Production continues running the existing
`server/` application. Shared HTTP infrastructure lives in `packages/http`;
release selection, connection settings and execution reuse `scripts/release`.

## Set up the Mac mini

From the persistent `main` checkout on the release Mac, run:

```sh
just install-devportal-agent
```

On first installation, the command opens the setup wizard. It checks the
installed tools, Docker and Tailscale, opens the existing
credential wizard when needed, and asks which Tailscale users can release. Review
its summary, approve installation, and follow any Tailscale HTTPS approval link
shown in the terminal. It saves private settings, installs startup at login,
preserves other Serve/Funnel services, and prints the exact app URL.

On your iPhone or Mac, connect Tailscale, open **Mintomo Devportal → Connection
settings**, and paste that URL. Build the **MintomoDevportal** Xcode scheme to
install the app. All allowed users can view, start and approve portal releases.
No release runs during setup.

If your tailnet policy blocks access, the wizard prints the destination and port
to give your administrator. It cannot change your organization's access policy.
If the dashboard requests server setup, run `just release-server` once on the
release Mac; the portal then handles subsequent application releases.

## Update after merging changes

Run the same command:

```sh
just install-devportal-agent
```

It detects the existing LaunchAgent, reuses its saved settings directory, fetches
merged `origin/main`, updates the checkout by fast-forward, refreshes the pinned
tools and locked dependencies, and reinstalls/restarts the service using the new
runtime. Settings, release history and Tailscale configuration are preserved;
the setup questions are skipped. No production release runs.

The command refuses to change an active release, a dirty checkout or a development
branch. A failed update can be retried with the same command; local commits are
never reset. The portal is briefly unavailable while updating.

Use `just setup-devportal` when you deliberately want to change the allowed users
or connection settings. Keep the release user logged in, the Mac awake, and
Docker and Tailscale running. The service starts at login, not before login.

## Settings and troubleshooting reference

```sh
just setup-devportal --help
just devportal-agent-status
```

Use `just setup-devportal --config-dir DIRECTORY` or `TCG_CONFIG_DIRECTORY` for an
alternative private settings directory. The default is `$HOME/.config/tcg`.
`devportal.json` contains `allowedLogins` and the loopback backend `port` (8787 by
default); credentials stay in the existing `release.env`, deployment key and
verified `known_hosts` files. The wizard writes portal settings with mode 0600.

Installation captures this checkout's path, Node executable and tool PATH in a
private user LaunchAgent. Rerun installation after moving the checkout or changing
tool locations. For foreground troubleshooting, stop the LaunchAgent before running
`just devportal`; do not run both instances. Service logs are in
`$HOME/.config/tcg/devportal-logs`.

The backend listens only on `127.0.0.1`. Tailscale Serve supplies the authenticated
`Tailscale-User-Login` header, which the backend checks against its allowlist.
Local processes on the release Mac are trusted. Keep the backend private and use
Serve for access from other devices. Tagged devices without user identity are
rejected. The app stores only an HTTPS `*.ts.net` URL, with no deployment secrets.

The wizard uses HTTPS 443, 8443 or 9443, choosing a free listener or reusing the
same portal mapping. It refuses to overwrite another service or reuse a public
Funnel endpoint. See the
[Tailscale Serve reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

## iOS and macOS releases

Choose **Release destination** on the dashboard to switch between Server, iOS and
macOS. App releases run the same verification, automatic signing and App Store
Connect upload pipeline as `just release-ios` and `just release-macos`.
Run `just setup-app-release` on the release Mac first, using the same settings
directory as the service. The app reports a setup blocker until configured.

Review pins main and the platform's saved team and production API hostname.
Approve signing and upload separately. Closing the client does not stop the job;
reconnect to see progress and pending approvals. Successful upload means Apple
processing is pending, not that the app is published. Check App Store Connect
before retrying an interrupted upload. All existing allowed operators can release
apps; no account credentials are sent to the client.

Keep the release user logged in and Keychain unlocked. First-time signing or an
expired Apple session may require local action in Xcode. See the
[app release guide](../app/release.md) for prerequisites, build numbering and logs.

## Server release behavior

The dashboard lists every commit on freshly fetched remote `main` absent from the
running server, including app-only commits. Review fixes the exact selected SHA.
The service runs the same checks, image publishing, migration readiness checks,
approval rechecks, deployment and health verification as the guided CLI.

Infrastructure review and server setup stay in `just release-server`. If setup is
required, the portal blocks before building. Migration and deployment each require
a separate explicit approval. If the host changes during approval, review the
refreshed target and approve again. Declining stops before that operation.

Closing the app does not cancel a build. Reconnect to its active release; pending
approvals remain paused. Restarting the service marks unfinished sessions
interrupted. Retry explicitly to recheck the host and reuse verified published
images. There is no automatic application or database rollback.

Private session state lives under `$HOME/.config/tcg/devportal-releases`; command
logs remain under `$HOME/.config/tcg/releases`. Service logs live in
`$HOME/.config/tcg/devportal-logs`. Guided CLI and portal execution share the local
`release.lock` lease; remote commands retain their own safeguards. Do not delete a
lease while a release or one of its child commands is running. A stale lease from
a terminated process is reclaimed automatically; malformed leases require manual
inspection on the Mac mini.

```sh
just uninstall-devportal-agent
```

Uninstall preserves settings and history. Stop a running release before updating
or uninstalling the service. Configure Serve separately; uninstall does not change
unrelated Tailscale settings.

## Contract and verification

The Hono routes define the independent OpenAPI contract used by the Swift build
plugin. Regenerate after route changes:

```sh
just download-devportal-spec
pnpm --filter @tcg/devportal typecheck
pnpm --filter @tcg/devportal test
just quality
just ready
```

Integration tests exercise authorization, persistence, approvals and retries
through Hono, with controlled external commands. The existing release tests cover
real temporary Git histories and the shared pipeline. Root app checks build both
targets and run Devportal model and snapshot tests on macOS and iOS. Follow the
repository's simulator recipes and localization-catalog workflow.

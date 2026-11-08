# Release from the Mac mini

[All release guides](README.md) · [One-time setup](setup.md) · [GitHub Actions](github-actions.md)

After setup, merge your changes into `main`. Keep Docker running and Tailscale
connected on the Mac mini, then run this from the repository root:

```sh
just release-server
```

The CLI guides you through the release:

1. Fetch `main` and show the exact commit and target server.
2. Offer an infrastructure plan. You can skip it for ordinary app changes.
   Applying a plan and configuring the host each need your approval.
3. Run server checks, build the Linux images, and upload them to GHCR.
4. Check the database. If migrations are pending, ask before applying them.
5. Ask before restarting the app, then verify the live release, database and storage.

Wait for **Release checks passed.** A configured API hostname automatically selects
public HTTPS; otherwise the server stays private.

## First guided release

An existing server may need updated release tools. The CLI offers to configure it
using your saved infrastructure settings. Approve this once. Infrastructure steps
need the credentials in `$HOME/.config/tcg/infrastructure.env`; ordinary releases
only need `$HOME/.config/tcg/release.env` and your Docker registry login.

If Docker is not signed into GHCR, create a GitHub personal access token (classic)
with `write:packages` and package access, then use that **token as the password**:

```sh
docker login ghcr.io --username "$(gh api user --jq .login)"
```

`just rotate-keys` guides you through renewing expired credentials. Changed host
credentials need host configuration again; the release CLI offers that step after
an infrastructure plan.

## If a release fails

Fix the reported problem and run `just release-server` again. The CLI offers to
resume an unfinished release, verifies saved images and checks the actual server
and database again. It never treats a database connection error as permission to
run migrations. Failed infrastructure applies always require a fresh plan.

Detailed output stays in a private log under `$HOME/.config/tcg/releases`.
A stopped release keeps its published images available for retry.

Before approving migrations, back up the production database and confirm the
running app supports the new schema. Migrations are never automatically reversed.
The guided flow does not automatically roll back application images.

## Optional commands

Release a specific commit already merged into `main`:

```sh
just release-server YOUR_FULL_COMMIT_SHA
```

Use another settings directory:

```sh
just release-server --config-dir "$HOME/.config/another-tcg"
```

For automation, the existing non-interactive release is still available. It checks
migration readiness but never applies migrations:

```sh
just release-server --non-interactive origin/main private false
# For a configured public hostname, replace private with public.
```

Existing GitHub Actions workflows keep their separate migration and deployment
approvals. See [GitHub Actions](github-actions.md).

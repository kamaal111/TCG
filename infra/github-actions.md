# Release with GitHub Actions

[All release guides](README.md) · [Prepare the server](setup.md) · [Release from the Mac mini instead](release.md)

Complete the server setup first. GitHub will build and upload images, then connect
to the same Droplet through Tailscale. You do not need to run a local release first.

## Set up Actions once

### 1. Allow GitHub runners into Tailscale

Add this entry to your tailnet's `tagOwners` object:

```json
"tag:tcg-ci": ["autogroup:admin"]
```

Add this entry to its `grants` list, preserving existing entries:

```json
{
  "src": ["tag:tcg-ci"],
  "dst": ["tag:tcg-server"],
  "ip": ["tcp:22"]
}
```

In Tailscale, create an **OAuth client** with **Auth Keys → Write** permission
and the tag `tag:tcg-ci`. Save its client ID and secret privately. This is separate
from the single-use server bootstrap key.
[Tailscale GitHub Action setup](https://tailscale.com/docs/integrations/github/github-action).

### 2. Create the production environment

In your GitHub repository, open **Settings → Environments** and create `production`.
Restrict deployment branches to `main` and configure required reviewers.
If your plan does not support those protections, arrange an equivalent review
control before using Actions for production releases.

Add these **environment secrets**:

| Secret                      | Value                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| `TAILSCALE_OAUTH_CLIENT_ID` | Client ID from step 1                                              |
| `TAILSCALE_OAUTH_SECRET`    | Client secret from step 1                                          |
| `DEPLOY_HOST`               | Exact Tailscale hostname in the Mac's `release.env`                |
| `DEPLOY_SSH_KEY`            | Complete contents of `$HOME/.config/tcg/deploy-key`                |
| `DEPLOY_KNOWN_HOSTS`        | Complete verified line from `$HOME/.config/tcg/deploy-known-hosts` |

The deployment private key must work without an interactive passphrase.
Do not add the DigitalOcean or Terraform tokens to this environment.

### 3. Confirm image publishing and download access

The workflows must be merged into `main`. The workflow requests `packages: write`
for GitHub's built-in `GITHUB_TOKEN`; no separate publishing token is needed.

If the GHCR packages already exist, give this repository access through each
package's **Manage Actions access** settings. Check both the `-server` and
`-server-migrations` packages. The image name is always
`ghcr.io/owner/repository-server` in lowercase, matching the server setup.
The Droplet's registry account must be able to download both packages.
[GitHub package access](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions).

Setup is complete. Use the steps below for each release.

## Release each time

### 1. Choose the commit

Merge the code into `main` and copy the full commit SHA from GitHub. Use that same
SHA for migrations and release, so both operations use the same code.

### 2. Apply migrations if needed

Skip this step if the database already has the chosen commit's migrations.
Before changing the schema, back up the database and confirm the running
application supports the new schema.

1. Open **Actions → Run database migrations → Run workflow**.
2. Select branch **main** and enter the chosen SHA in **revision**.
3. Run the workflow and approve its `production` deployment when prompted.
4. Wait for the whole workflow to succeed.

This uses the Droplet's database credentials. It does not restart the application.

### 3. Release the application

1. Open **Actions → Release server → Run workflow**.
2. Select branch **main** and enter the same SHA in **revision**.
3. Choose **private** for **exposure**.
4. Leave **schema_compatible_rollback** unchecked.
5. Run the workflow and approve its `production` deployment when prompted.
6. Wait for the whole workflow to succeed, including the deployment job.

The workflow checks the code, builds and uploads images, deploys them, and checks
application health, database access, and storage access. Private mode does not
create a public API URL. A release causes a brief restart.

## If the workflow fails

- **Build failed:** fix the reported checks or package publishing permissions.
- **Approval pending:** review and approve the `production` deployment.
- **Migration check failed:** complete the migration workflow for the same SHA.
- **Server operation failed:** use the Mac's private [deployment check](release.md#4-verify) and the [Droplet recovery commands](reference.md#verification-and-recovery).

GitHub suppresses private SSH diagnostics. Do not paste credentials or private
host logs into public workflow output. Rollback is disabled by default; enable it
only after confirming schema compatibility. Migrations are never automatically reversed.

For public exposure, complete [domain setup](reference.md#add-public-https) first,
then select **public** when releasing.

Infrastructure plan/apply workflows have a separate
[setup and review process](reference.md#run-infrastructure-changes-through-github-actions).
They are optional when infrastructure is managed from the Mac.

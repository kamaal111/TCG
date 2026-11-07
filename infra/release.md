# Release from the Mac mini

[All release guides](README.md) · [One-time setup](setup.md) · [Use GitHub Actions instead](github-actions.md)

Use this after setup. Run commands on the Mac mini from the repository root.
Merge the code into `main` first. Uncommitted changes are not released.

## 1. Check the Mac is ready

Keep Docker running and Tailscale connected:

```sh
docker info
tailscale status
```

For your first local release, sign Docker into GHCR with a GitHub **personal access
token (classic)** that has `write:packages` and package access. Enter the token at
the password prompt:

```sh
docker login ghcr.io --username "$(gh api user --jq .login)"
```

Repeat login when the token expires or Docker reports an authentication error.
[GitHub registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## 2. Apply database migrations if this release needs them

Releasing does **not** apply migrations. If the database already has this release's
migrations, continue to step 3.

For a release with migrations, use a clean checkout of the same merged commit you
will release. Back up the production database and confirm the currently running
application can use the new schema before applying it.

Use your existing private production database configuration. For example, if the
currency collector's `currencies.env` points to this same database:

```sh
env -u DATABASE_URL just --dotenv-path "$HOME/.config/tcg/currencies.env" migrate
```

Continue only after `Database migrations completed.` If you do not have a database
configuration yet, follow [database connection setup, steps 1–3](../server/docs/digitalocean-database.md#1-allow-the-mac-to-connect).
Use its public direct connection URL and verified TLS certificate on the Mac.
The [GitHub migration workflow](github-actions.md#2-apply-migrations-if-needed)
can also apply migrations using the Droplet's credentials once Actions is set up.

## 3. Release

For the latest code merged into `main`:

```sh
just release-server
```

For a specific commit already merged into `main`:

```sh
just release-server YOUR_FULL_COMMIT_SHA
```

If you applied migrations in step 2, use that same commit SHA here.
The command reads `$HOME/.config/tcg/release.env`, runs server checks, builds and
uploads the images, and deploys them. Wait for:

```text
Release checks passed.
```

## 4. Verify

```sh
just --dotenv-path "$HOME/.config/tcg/release.env" deployment-check
```

The command must exit successfully. This checks the application and its database
and storage dependencies. Private releases listen on the Droplet's loopback
interface; they do not provide a public API URL.

## If a release fails

- **Pending migrations:** complete step 2, then retry the same commit.
- **Registry authentication:** renew the Mac's publishing token or the Droplet's download token as appropriate. A changed Droplet token needs `infra-configure` again.
- **SSH failure:** check Tailscale, the deployment key, and the hostname/host-key pairing in `release.env`.
- **Failure after switching images:** inspect the Droplet using the [recovery commands](reference.md#verification-and-recovery). Automatic rollback is disabled by default.

Do not enable rollback unless the previous application supports the current schema.
Migrations are never automatically reversed. Releases cause a brief restart.

For public HTTPS, complete [domain setup](reference.md#add-public-https) first,
then use `just release-server origin/main public` (or the exact commit SHA instead
of `origin/main`).

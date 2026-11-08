# Infrastructure reference

For ordinary setup and releases, start with [one-time setup](setup.md),
[Mac releases](release.md), or [GitHub Actions releases](github-actions.md).
This page holds maintenance, infrastructure automation, and recovery details.
Run commands from the repository root unless stated otherwise.

## Ownership

| Owner            | Configuration                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Terraform        | Existing/imported Droplet and PostgreSQL cluster, database trusted sources, Droplet firewall, replacement private Spaces bucket, runtime key, staged storage policy, optional DNS A record |
| Ansible          | Docker, Tailscale, restricted deployment user, persistent authentication secret, database CA, private runtime configuration, installed release scripts                                     |
| Docker Compose   | Runtime container, restart policy, health checks, bounded logs, optional Caddy HTTPS proxy                                                                                                 |
| GitHub Actions   | Reviewed infrastructure plan/apply and manual immutable application releases                                                                                                               |
| Existing Mac job | Daily currency collection; unchanged by server deployment                                                                                                                                  |

Use `mise install --locked terraform python uv pypi:ansible-core` for the
infrastructure tools, or `mise install` for all repository development tools.
`mise.toml` owns their versions. Commit `mise.lock` and its generated
`.mise/locks/` dependency sidecars together; Ansible runs through `mise exec`.
Provider locks are committed in both Terraform roots. CI reads the same mise
configuration rather than repeating tool versions in workflow inputs.

Use the latest stable, supported versions for new infrastructure tooling.
The controller uses Python **3.14**, resolved to a patch by mise and recorded in
`mise.lock`. Ansible 2.21 supports controller Python 3.12–3.14, so Python 3.15
awaits a stable Ansible release that supports it. This isolated environment
does not replace the Droplet's Debian-managed Python or the Node server runtime.
Ansible dependency resolution enforces a 24-hour minimum release age. Refresh
with `mise lock --bump python uv terraform pypi:ansible-core`, review the generated
graph, and rerun verification. Exact pins must first be updated in `mise.toml`.
`just check-versions` also checks Terraform constraints/provider locks and shared
GitHub Action references across workflows. Actions use major release tags;
maintainers advance those tags to patch/minor releases. Review compatibility,
and advisories before updating them.

## Token expiration and replacement

Use the guided replacement menu:

```sh
just rotate-keys
```

Select one or more local credentials. Setup and rotation share the same retrieval
instructions and required permissions. Replacements are saved only after
confirmation; cancellation leaves the old credentials unchanged. The command
prints the activation steps and does not run them or revoke old keys.

The GitHub publishing-token option explains manual Docker login without collecting
or storing that token. At Docker's `Password:` prompt paste the publishing token,
not the GitHub account password. Replacing a Tailscale bootstrap key does not
change an already connected machine's identity. GitHub Actions secrets must still
be updated separately.

Use `--config-dir` for a different private directory. Existing exported environment
variables can override saved files when running infrastructure commands; the
wizard warns about conflicting names without printing their values.

For manual replacement:

Record each token's purpose and expiration date in your password manager, and set
a reminder before it expires. This applies to both the DigitalOcean personal access
token and the HCP Terraform user API token. Save newly generated tokens immediately;
their secrets are only displayed once.

Before expiration, create a replacement token with the same required permissions
and update the corresponding entry in `$HOME/.config/tcg/infrastructure.env`:

- DigitalOcean: `DIGITALOCEAN_TOKEN`.
- HCP Terraform: `TF_TOKEN_app_terraform_io`.

Use the [DigitalOcean scope checklist](setup.md#3-create-the-digitalocean-api-token)
when recreating its token.

If infrastructure workflows are configured in GitHub, update their copies too:
`DIGITALOCEAN_TOKEN` and `TF_API_TOKEN`, respectively. Check for exported shell
variables or other private environment files that still contain the old token.

Run this with the updated private environment file to verify access:

```sh
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" infra-plan
```

Review the result; token replacement itself does not require applying infrastructure
changes. Revoke the old token after confirming the replacement works. If it already
expired, create a replacement and follow the same steps. Expiration prevents new
authenticated infrastructure operations; it does not stop the deployed application
or require recreating resources or Terraform state. Ordinary Mac releases use
`release.env` and do not need either infrastructure token.

## Deployment SSH key maintenance

Local deployment SSH runs with `BatchMode=yes`. If your deployment key has a
passphrase, unlock it in an SSH agent before releasing. To remove a passphrase
while keeping the same key pair:

```sh
ssh-keygen -p -f "$HOME/.config/tcg/deploy-key"
```

Enter the current passphrase, then leave the new passphrase and confirmation empty.
GitHub's deployment key must be usable without an interactive passphrase.

## Infrastructure plans

`infra-apply` applies the exact saved plan and requires the same repository commit.
Plans are private files under `infra/environments/production/.terraform/`.
Do not publish their contents. Regenerate and review the plan if state becomes stale.
A plan from a dirty checkout includes that checkout's configuration.

The plan guard rejects Droplet, database, and bucket deletion or replacement.
Terraform also sets `prevent_destroy` for those resources. Intentional replacement
requires a separately reviewed code change. Imported Droplet image, SSH-key, and
bootstrap attributes are ignored so adoption does not replace the existing host.

## Host configuration and locking

`infra-configure` reads sensitive Terraform inventory into a temporary mode-600 file,
uses Ansible with secret output suppressed, and removes the temporary directory.
It adopts the existing Docker installation, enables Docker/Tailscale after boot,
and installs configuration under `/opt/tcg`. Runtime credentials stay on the
Droplet. The database CA is mounted read-only at `/run/tcg/database-ca.crt` inside
containers; a Mac-local certificate path cannot work in the container.

The authentication secret is generated once and reused on subsequent runs.
Configuration and release share a host lock directory. If the connection is
interrupted and a lock remains, inspect the host for active configuration/release
processes before manually removing `/opt/tcg/.deployment-lock`.

The playbook is intended to converge when rerun, not recreate the host. Changes
to runtime environment files take effect on the next release; changing the API
hostname requires reconfiguration and a release in the matching exposure mode.
Secrets/configuration require backup before intentional host replacement; HCP
state is not a backup of the host-generated authentication secret or Caddy data.

## Run infrastructure changes through GitHub Actions

Create GitHub environments `production` and `production-infrastructure`, restrict
their deployment branches to main, and configure required reviewers before using
infrastructure apply. If your GitHub plan does not support those protections for this
repository, keep infrastructure apply local until an equivalent review control is
in place. A workflow environment name alone does not create an approval gate.

Set these repository variables:

| Variable                                | Value                  |
| --------------------------------------- | ---------------------- |
| `TF_CLOUD_ORGANIZATION`, `TF_WORKSPACE` | The HCP state location |

Set these repository secrets for the infrastructure workflow:

| Secret                                                         | Value                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `TF_API_TOKEN`                                                 | HCP state token                                                                            |
| `DIGITALOCEAN_TOKEN`                                           | Infrastructure-management token                                                            |
| `SPACES_ADMIN_ACCESS_KEY_ID`, `SPACES_ADMIN_SECRET_ACCESS_KEY` | Administrative Spaces credentials                                                          |
| `TF_PRODUCTION_VARS_JSON`                                      | JSON equivalent of the ignored production tfvars, including `configuration` and import IDs |
| `INFRA_PLAN_ENCRYPTION_KEY`                                    | Random strong passphrase for encrypted, one-day plan artifacts                             |

The plan job uses these repository secrets and runs only from main. Apply waits
for the `production-infrastructure` environment approval, checks the plan hash,
and uses the exact plan from that run. Public logs and summaries contain status
and the plan hash, not raw Terraform output or resource addresses. Every successful
plan, including a plan-only run, uploads an encrypted artifact containing the
binary plan, commit, and readable plan. Review it privately before approving.

Use the numeric run ID from the workflow URL (`/actions/runs/RUN_ID`) below.
GPG prompts for the passphrase stored as `INFRA_PLAN_ENCRYPTION_KEY`; enter it
privately instead of placing it in a command argument:

```sh
TCG_REVIEW_RUN_ID=REPLACE_WITH_RUN_ID
TCG_REVIEW_DIRECTORY="$HOME/.config/tcg/infra-review-$TCG_REVIEW_RUN_ID"
umask 077
mkdir -p "$TCG_REVIEW_DIRECTORY"
chmod 700 "$TCG_REVIEW_DIRECTORY"
gh run download "$TCG_REVIEW_RUN_ID" -n encrypted-infrastructure-plan -D "$TCG_REVIEW_DIRECTORY"
gpg --output "$TCG_REVIEW_DIRECTORY/plan.tar" --decrypt "$TCG_REVIEW_DIRECTORY/plan.gpg"
tar -C "$TCG_REVIEW_DIRECTORY" -xf "$TCG_REVIEW_DIRECTORY/plan.tar" review.txt review.commit review.tfplan
less "$TCG_REVIEW_DIRECTORY/review.txt"
shasum -a 256 "$TCG_REVIEW_DIRECTORY/review.tfplan"
```

Compare the printed hash with the workflow summary before approving. Keep the
decrypted files private and remove that review directory when finished. The apply
job never substitutes a new plan after approval. Its diagnostics are kept out of
public logs; reproduce a failed plan locally with the private environment file
for details.

## Release behavior

Mac releases fetch `main` and extract the selected merged commit into a private
temporary directory. Dependencies and `just ready-server` run there. The current
branch and working files stay in place. Temporary sources and image metadata are
removed on exit; Docker retains its existing build cache and registry login.

Both release paths publish matching Linux amd64 runtime and migration images and
deploy immutable digests. The Droplet verifies their source commit labels, checks
database TLS, tests storage read/write/delete, and checks migration history before
switching the application. Releases never apply migrations. Failed checks before
the switch leave the running release in place.

After switching, the dispatcher checks application health and dependencies again.
A failure restores the previous image only when schema-compatible rollback was
explicitly enabled. Database migrations are never automatically reversed.

GitHub infrastructure, release, and migration workflows share a production
concurrency group. Host configuration and releases share a host lock. Avoid running
local and GitHub production operations at the same time.

For local releases, `TCG_RELEASE_ENV_FILE` selects a different private settings
file. That file is sourced by Bash; quote values containing spaces. Exported shell
variables override its deployment host, key, known-hosts, and image repository.
For `deployment-check`, supply the settings explicitly with `--dotenv-path`.

## Enable storage source-IP restriction

First verify storage read/write/delete from the deployed container's real network
route. Then set `enable_storage_ip_restriction = true`, plan, review, apply, and
repeat the dependency check. Test a signed object/list request using the same
credentials from another machine: it must fail. An anonymous 403 does not prove
the IP restriction. Terraform unit tests are not a substitute for this live test.

The policy derives its `/32` address from the Droplet resource and rejects empty
or invalid addresses. It denies object access/listing outside that address, but
**preserves authenticated bucket-policy management from other addresses** so an
administrator can repair a bad network assumption. Anyone holding the full-access
administrative/runtime credential can still change the policy: this protects the
data path, not against a compromised administrator. Spaces currently disallows
limited per-bucket keys together with bucket policies, so full-access keys have
broader account permissions; use a dedicated DigitalOcean team for isolation if
other unrelated buckets must not be accessible with that credential.

Set the flag back to false and apply a reviewed plan to remove the source-IP
restriction while retaining private object permissions. Do not use a blanket
`s3:*` deny. The previous manual policy saved `/32` because a shell variable was
empty, blocking the Droplet and administrative removal. That empty bucket was
deleted; it is not needed for this implementation.

## Add public HTTPS

A domain is not needed for provisioning or private acceptance checks. When you
choose one, set `api_hostname` and point its A record to the Droplet. If its DNS
zone is already hosted at DigitalOcean, also set `manage_dns`, `dns_zone`, and
`dns_record`; otherwise create the A record with the current DNS provider.

Apply the reviewed infrastructure plan (opens TCP 80/443), rerun host configuration,
and release with `exposure=public`. Caddy obtains certificates and forwards to
the private application container. Certificate state persists in Docker volumes.
Public releases without a hostname, or with a mismatched authentication origin,
fail before pulling images or switching the application. The application port 8080 is
never published on the public interface.

## Verification and recovery

### An infrastructure apply stopped partway through

Terraform records successfully completed imports and resource changes in state
even if a later operation fails. Do not delete or recreate successful resources to
retry. Correct the reported problem, then generate and review a new plan:

```sh
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" infra-plan
```

Apply the newly reviewed plan with `infra-apply`. Do not reuse the old saved plan
after a partial apply. For a 403 when untagging resources, ensure the replacement
DigitalOcean token includes `tag:delete` as well as the affected resource's Update
permission; follow [token replacement](#token-expiration-and-replacement).

### Checks and host inspection

The manually invoked workflows declare triggers, permissions, approvals, and
explicit inputs. Release and migration workflows share the reusable image builder
and protected server-operation workflow. Database migration is a separate explicit
operation in both GitHub and local use.
Their executable logic lives in these reviewable scripts:

- [Infrastructure workflow](../.github/scripts/infrastructure.sh): public plan hash,
  encrypted approval artifact, verified apply, and plaintext plan cleanup. It
  delegates resource changes to the same `just infra-*` recipes used locally.
- [Release workflow](../.github/scripts/release-server.sh): merged-revision check
  and verified SSH release/migration operations, including private temporary files and cleanup.
- [Release metadata](../scripts/release-metadata.ts): image names, mise tool
  versions, and immutable digest references written to GitHub step outputs.

```sh
just infra-check
just test-scripts
just test-migration-image
just ready-server
```

`infra-check` uses mocked providers, validates both Terraform roots without HCP
access, checks Ansible syntax/templates, and checks shell syntax. It creates no
cloud resources. Docker Compose validation uses temporary fixture configuration
without starting services. CI also validates workflows. Migration-image tests apply the
same image twice against an isolated PostgreSQL container.

On the Droplet, administrative inspection uses:

```sh
sudo docker compose --project-directory /opt/tcg \
  --env-file /opt/tcg/host.env --env-file /opt/tcg/release.env ps
sudo docker compose --project-directory /opt/tcg \
  --env-file /opt/tcg/host.env --env-file /opt/tcg/release.env logs --tail 100 server
```

Do not share runtime environment files, state, private keys, or unredacted debug
logs. Failed releases return a nonzero status to GitHub. Inspect the previous
image references in `/opt/tcg/previous-release.env`; explicit rollback can use the
release workflow with a previous merged revision, subject to schema compatibility.
There is a brief restart window during a release; this is a single-Droplet setup,
not a zero-downtime deployment. Verify reboot recovery and a second no-change
Terraform/Ansible run as live acceptance checks before relying on production.

The existing Mac [currency scheduler](../server/README.md#schedule-collection-on-a-macos-home-server)
is independent: it persists across reboots and reinstalling replaces the same job.
Its database trusted-source IP must remain in Terraform configuration.

## References

- [Terraform imports](https://developer.hashicorp.com/terraform/language/import)
- [HCP Terraform state](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/state)
- [DigitalOcean provider](https://docs.digitalocean.com/reference/terraform/)
- [Tailscale GitHub Action](https://tailscale.com/docs/integrations/github/github-action)
- [Spaces keys](https://docs.digitalocean.com/products/spaces/how-to/manage-access/)

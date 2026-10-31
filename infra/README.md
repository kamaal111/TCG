# TCG infrastructure and releases

This is the source of truth for DigitalOcean resources, Debian host configuration,
and manually triggered application releases. Commands run from the repository
root on your development machine unless explicitly marked otherwise. No recipe
runs `terraform destroy`. Initial setup does not deploy a public API without a domain.

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
See the [version audit](VERSION-AUDIT.md) for the checked versions and sources.

## 1. One-time accounts and private credentials

Use an HCP Terraform organization and create a workspace for this environment.
Set its **Execution Mode to Local**: Terraform runs locally or on a GitHub runner,
while HCP supplies remote state and locking. Do not enable VCS auto-apply for it.
State includes database credentials and Spaces key secrets. Limit state access,
retain HCP state history, and never commit state or upload plaintext plans.

Create a private configuration file:

```sh
mkdir -p "$HOME/.config/tcg"
touch "$HOME/.config/tcg/infrastructure.env"
chmod 600 "$HOME/.config/tcg/infrastructure.env"
nano "$HOME/.config/tcg/infrastructure.env"
```

Replace every placeholder in this template with your own value:

```dotenv
TF_CLOUD_ORGANIZATION=YOUR_HCP_ORGANIZATION
TF_WORKSPACE=YOUR_HCP_WORKSPACE
TF_TOKEN_app_terraform_io=YOUR_HCP_API_TOKEN
DIGITALOCEAN_TOKEN=YOUR_DIGITALOCEAN_API_TOKEN
SPACES_ACCESS_KEY_ID=YOUR_SPACES_ADMIN_KEY
SPACES_SECRET_ACCESS_KEY=YOUR_SPACES_ADMIN_SECRET
TCG_DEPLOY_PUBLIC_KEY="YOUR_DEPLOYMENT_SSH_PUBLIC_KEY"
TCG_IMAGE_REPOSITORY=ghcr.io/YOUR_LOWERCASE_OWNER/YOUR_LOWERCASE_REPOSITORY-server
TCG_TAILSCALE_AUTH_KEY=YOUR_TAGGED_SINGLE_USE_SERVER_BOOTSTRAP_KEY
# Needed to pull private GHCR images; omit both if the images are public.
TCG_REGISTRY_USER=YOUR_GITHUB_USERNAME
TCG_REGISTRY_TOKEN=YOUR_READ_PACKAGES_TOKEN
```

In nano, save with Control+O, Enter, then exit with Control+X. These are local
private inputs, not repository files. Do not paste secrets into chat or shell
arguments. The Spaces admin key is a full-access key, separate from the runtime
key Terraform creates. Review DigitalOcean API token permissions for the listed
resources. The infrastructure token must not be available to ordinary release jobs.

Generate a dedicated deployment SSH key on your development machine:

```sh
ssh-keygen -t ed25519 -f "$HOME/.config/tcg/deploy-key" -C tcg-release
cat "$HOME/.config/tcg/deploy-key.pub"
```

For unattended GitHub deployment, the private key must be usable without an
interactive passphrase and stored as a protected GitHub secret. Put the public
key's complete single line in `TCG_DEPLOY_PUBLIC_KEY`. It authorizes only the
installed `release`/`check` dispatcher, not an interactive shell or port forwarding.
The deploy user is not in the Docker group; its sudo permission is limited to
that dispatcher. Releasing a trusted image is nevertheless a privileged operation.

## 2. Adopt the resources already created

Copy the example to the ignored input file:

```sh
cp infra/environments/production/terraform.tfvars.example \
  infra/environments/production/terraform.tfvars
nano infra/environments/production/terraform.tfvars
```

In DigitalOcean, open the existing Droplet and database cluster. Record their IDs
(from their page URLs), names, region, sizes, database version/node count, and
VPC UUIDs. The configuration must match the existing resources exactly. Both
must share the VPC used for the private database connection. Do not create new
copies just to get IDs. Droplet creation-only image/SSH/bootstrap attributes are
ignored on adoption so Docker installation is not replayed by replacing the host.

Set `existing_droplet_id` and `existing_database_id`. These import blocks adopt
the Droplet, database, and database trusted-source rules. List **all** database
client IPv4s to preserve, including the Mac running daily collection. List narrow
administrator IPv4 CIDRs to keep SSH recovery access. Audit any other already
attached Droplet firewalls: multiple firewalls may allow additional traffic.

Set `application_database` to the logical database in the connection URL you
already migrated. The default is `defaultdb`, which exists on new managed
clusters. A custom logical database must already exist; this configuration does
not silently create or switch to a different database during adoption.

Use a new globally unique `bucket_name`: the deleted bucket name may remain
reserved. Leave `enable_storage_ip_restriction = false` and `api_hostname = ""`
for initial private testing. This creates private storage, not public-readable
objects. The deleted, locked bucket is not imported.

```sh
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" infra-init
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" infra-plan
```

Review the plan. The existing Droplet IP and database must be preserved. Expected
new resources include the private bucket, runtime key, and managed host firewall.
Correct mismatched imported attributes before applying. The plan guard refuses
Droplet, database, or bucket deletion/replacement, and Terraform also declares
`prevent_destroy`. Intentional future replacement requires a separately reviewed
code change; ordinary deploys cannot request it.

Only after review:

```sh
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" infra-apply
```

This applies the exact saved plan, with a matching repository commit. Plans are
private, ignored files under `.terraform/`; do not send their JSON to logs. If
Terraform reports stale state, regenerate and review a plan. A subsequent plan
should contain no unexpected changes. Local plans from a dirty checkout still
capture that checkout's configuration: review it before applying.

## 3. Configure the host and private network

Create a Tailscale account/tailnet. Merge `infra/tailscale-policy.hujson` into its
existing policy instead of overwriting unrelated tailnet rules. Allow administrators
to own the server/CI tags and allow `tag:tcg-ci` to reach `tag:tcg-server` on TCP 22.
Create a single-use server registration key tagged `tag:tcg-server`. Create a
separate OAuth client permitted to create ephemeral CI devices with `tag:tcg-ci`.
If the tailnet already has broad default grants, narrow those too; merging a
narrow grant does not override an existing broad allow.

First host configuration uses your existing administrative SSH access. Verify
and record the Droplet's SSH host key using an already trusted SSH session or the
DigitalOcean console. Keep strict host-key checking enabled. The administrative
public SSH path remains restricted to your configured administrator CIDRs.

```sh
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" infra-configure
```

The recipe reads sensitive Terraform inventory into a temporary mode-600 file,
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

## 4. Configure GitHub and run a private release

Create GitHub environments `production` and `production-infrastructure`, restrict
their deployment branches to main, and configure required reviewers before using
apply/release. If your GitHub plan does not support those protections for this
repository, keep infrastructure apply local until an equivalent review control is
in place. A workflow environment name alone does not create an approval gate.

Set these repository variables:

| Variable                                | Value                                                    |
| --------------------------------------- | -------------------------------------------------------- |
| `TF_CLOUD_ORGANIZATION`, `TF_WORKSPACE` | The HCP state location                                   |
| `DEPLOY_HOST`                           | The server's Tailscale address or full MagicDNS hostname |

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
and uses the exact plan from that run. Review the plan in the run summary before
approving. Sensitive provider attributes are redacted, but resource names/IPs
remain visible to people who can view workflow logs. The apply job never silently
substitutes a new plan after approval.

Set these secrets in the `production` environment for application releases:

| Secret                                                | Value                                            |
| ----------------------------------------------------- | ------------------------------------------------ |
| `TAILSCALE_OAUTH_CLIENT_ID`, `TAILSCALE_OAUTH_SECRET` | Tagged ephemeral CI device credentials           |
| `DEPLOY_SSH_KEY`                                      | Contents of the dedicated deployment private key |
| `DEPLOY_KNOWN_HOSTS`                                  | Verified known_hosts entry for `DEPLOY_HOST`     |

The known_hosts hostname must match the Tailscale destination used by the workflow;
verify its key against the trusted server key, not an unauthenticated scan alone.
The runtime image repository is `ghcr.io/OWNER/REPOSITORY-server` in lowercase;
Ansible's `TCG_IMAGE_REPOSITORY` must match it. Both that package and the
`-migrations` package must be pullable with the Droplet's registry credentials.
Give the repository's `GITHUB_TOKEN` permission to publish those packages.

After merging the workflows into main, open **Actions → Release server → Run
workflow**. Choose a revision already merged into main and `exposure=private`.
Leave automatic rollback disabled unless you have confirmed the previous
application supports the resulting database schema.

The workflow runs server checks, builds runtime/migration images from the same
commit, publishes immutable digests, joins Tailscale, and invokes the fixed host
release dispatcher. The dispatcher pulls both images, verifies matching commit
labels, checks database TLS and actual storage read/write/delete, runs migrations,
then starts the server and checks liveness plus dependencies again.

Failed dependency checks/migrations leave the running release alone. A failure
after switching the application restores the previous image only if schema
compatibility was explicitly confirmed. Database migrations are never automatically
reversed. Infrastructure and release workflows share a production concurrency
group, and host configuration/releases share a host lock. Private releases bind
HTTP only to Droplet loopback, so the app is not yet publicly accessible.

For a subsequent private check, connect your development machine to Tailscale,
set `TCG_DEPLOY_HOST`, `TCG_DEPLOY_KEY` (file path), and `TCG_KNOWN_HOSTS` (file path)
in your private environment file, then run:

```sh
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" deployment-check
```

## 5. Enable storage source-IP restriction in a separate reviewed change

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

## 6. Add public HTTPS later

A domain is not needed for provisioning or private acceptance checks. When you
choose one, set `api_hostname` and point its A record to the Droplet. If its DNS
zone is already hosted at DigitalOcean, also set `manage_dns`, `dns_zone`, and
`dns_record`; otherwise create the A record with the current DNS provider.

Apply the reviewed infrastructure plan (opens TCP 80/443), rerun host configuration,
and release with `exposure=public`. Caddy obtains certificates and forwards to
the private application container. Certificate state persists in Docker volumes.
Public releases without a hostname, or with a mismatched authentication origin,
fail before pulling images or running migrations. The application port 8080 is
never published on the public interface.

## Verification and recovery

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

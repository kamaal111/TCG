# Prepare the release flow

[All release guides](README.md)

## Guided setup

From the repository root on the Mac mini, run:

```sh
just setup-infra
```

The wizard explains each question, saves private settings, and shows existing
answers as defaults. Choose resources and capacity using names such as
**Basic — 1 CPU, 1 GB RAM, 25 GB disk**; you do not need to find size slugs.
Saved capacity remains selected even when the running server still has a different
size. Review the before/after summary before saving changes.

Setup saves configuration only. It does not apply infrastructure, configure the
Droplet, log Docker in, or release the application. It prints the next commands.
If the server has not joined Tailscale yet, defer release access and rerun the
wizard after host configuration. Completed sections remain saved when cancelled.

Existing HCL and JSON Terraform files are supported. Unchanged settings are not
rewritten. Before a confirmed resource edit, the wizard keeps a private backup;
HCL formatting and comments may be regenerated. If both Terraform input formats
exist, it asks you to keep only one active file first.

Settings are saved in `~/.config/tcg` by default. No path argument is needed.
Use `just setup-infra --help` for prerequisites. The optional `--config-dir` flag
is only for using a different settings directory.
Install repository dependencies first with `just install-js-modules` and tools
with `mise install` if needed. Run `just rotate-keys` to replace local credentials.
Secrets are masked and existing secrets are retained without displaying them.

The steps below are the manual fallback.

Do this once on the **Mac mini**. The server will run on your existing
**DigitalOcean Droplet**. Run terminal commands from the repository root.
Complete one numbered step before moving to the next. Keep credentials in private
files and your password manager; do not commit them or paste them into chat.

## 1. Prepare the Mac and private settings file

Have Git, mise, just, GitHub CLI, Docker, and Tailscale installed. Start Docker and
connect the Mac to your existing tailnet. Install the repository's tools:

```sh
mise install
docker info
docker buildx version
gh auth status
tailscale status
```

Each command should succeed. Use `gh auth login` if GitHub CLI is not signed in.

Create the private file you will fill in during the next steps. Keep existing
values if you already started setup.

```sh
mkdir -p "$HOME/.config/tcg"
chmod 700 "$HOME/.config/tcg"
touch "$HOME/.config/tcg/infrastructure.env"
chmod 600 "$HOME/.config/tcg/infrastructure.env"
vim "$HOME/.config/tcg/infrastructure.env"
```

## 2. Set up HCP Terraform

Terraform uses HCP to store its record of your infrastructure.

1. Create an HCP Terraform organization and a **CLI-driven workspace** named `tcg-production`.
2. Set **Execution Mode** to **Local**. Leave VCS auto-apply disabled.
3. For **Remote state sharing**, choose **Share with specific workspaces** and leave the list empty.
4. Open **User Settings → Tokens → Create an API token**. Name it `tcg-mac-mini`, choose an expiration, and save it privately.

Add to `infrastructure.env`, replacing the placeholders:

```sh
TF_CLOUD_ORGANIZATION="YOUR_ORGANIZATION_IDENTIFIER"
TF_WORKSPACE="tcg-production"
TF_TOKEN_app_terraform_io="YOUR_HCP_USER_TOKEN"
```

Use the organization identifier from its URL and your actual workspace name.

## 3. Create the DigitalOcean API token

In DigitalOcean, open **Account → API → Tokens → Generate New Token**.
Name it `tcg-infrastructure-mac-mini`, choose an expiration, and select **Custom Scopes**.

| Resource                                     | Permissions                                      |
| -------------------------------------------- | ------------------------------------------------ |
| Account                                      | Read                                             |
| Droplet                                      | Read, Update                                     |
| Database                                     | Read, Update, View Credentials                   |
| Firewall                                     | Read, Create, Update, Delete                     |
| Spaces Key                                   | Read, Create, Create Credentials, Update, Delete |
| Tag                                          | Read, Delete                                     |
| Actions, Image, Regions, Sizes, SSH Key, VPC | Read only                                        |

Leave other scopes unchecked. Generate and save the token, then add:

```sh
DIGITALOCEAN_TOKEN="YOUR_DIGITALOCEAN_TOKEN"
```

These permissions are derived from our configuration for adopting existing
resources; they still need live verification. If a request fails with 403, check
its endpoint's scope before creating a replacement token. Existing token scopes
cannot be edited. [DigitalOcean scope reference](https://docs.digitalocean.com/reference/api/scopes/).

`tag:delete` is needed when adoption removes existing tags from the Droplet or
database. Untagging also requires the resource's Update permission, included above.
[DigitalOcean untagging permissions](https://docs.digitalocean.com/reference/api/reference/tags/).

Record the HCP and DigitalOcean token expiration dates and set renewal reminders.
When needed, follow [token replacement](reference.md#token-expiration-and-replacement).

## 4. Create the Spaces administrator key

In DigitalOcean, open **Spaces Object Storage → Access Keys → Create Access Key**.
Select **Full access**, name it `tcg-infrastructure`, and save the access key and
secret. This lets Terraform create and configure the bucket.

Add both values to `infrastructure.env`:

```sh
SPACES_ACCESS_KEY_ID="YOUR_SPACES_ACCESS_KEY"
SPACES_SECRET_ACCESS_KEY="YOUR_SPACES_SECRET"
```

## 5. Create the deployment SSH key

Run this once; keep an existing `deploy-key` if you already created it:

```sh
ssh-keygen -t ed25519 -f "$HOME/.config/tcg/deploy-key" -C tcg-release
```

Leave the passphrase empty for this unattended setup. If you added one already,
see [how to remove it](reference.md#deployment-ssh-key-maintenance).

Display the public key:

```sh
cat "$HOME/.config/tcg/deploy-key.pub"
```

Add its complete single line to `infrastructure.env`:

```sh
TCG_DEPLOY_PUBLIC_KEY="ssh-ed25519 YOUR_COMPLETE_PUBLIC_KEY tcg-release"
```

## 6. Choose the image name and allow the Droplet to download images

Use your GitHub repository's owner and name in lowercase, with `-server` appended.
For example, `example/TCG` becomes `ghcr.io/example/tcg-server`.

```sh
TCG_IMAGE_REPOSITORY="ghcr.io/YOUR_LOWERCASE_OWNER/YOUR_LOWERCASE_REPOSITORY-server"
```

No image needs to exist yet. The release command builds and uploads it later.

For private images, create a GitHub **personal access token (classic)** with
`read:packages` and access to the packages. Add:

```sh
TCG_REGISTRY_USER="YOUR_GITHUB_USERNAME"
TCG_REGISTRY_TOKEN="YOUR_READ_PACKAGES_TOKEN"
```

The Droplet must be able to download both the `-server` and `-server-migrations`
packages. Omit those two credentials only if both packages are public.
[GitHub registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## 7. Allow the Mac to reach the Droplet through Tailscale

Use your existing tailnet. Merge this entry into its `tagOwners` object:

```json
"tag:tcg-server": ["autogroup:admin"]
```

Add this entry to its `grants` list:

```json
{
  "src": ["autogroup:admin"],
  "dst": ["tag:tcg-server"],
  "ip": ["tcp:22"]
}
```

Create those sections if absent; preserve existing entries. The Mac must be signed
in as a tailnet administrator for this grant. Existing broad grants still apply.

Open **Settings → Keys → Generate auth key** and choose:

- **Description:** `tcg-server-bootstrap`.
- **Reusable:** off.
- **Ephemeral:** off.
- **Tags:** `tag:tcg-server`.
- **Pre-approved:** on, if shown.
- **Expiration:** allow enough time to finish setup.

Create the key and add it to `infrastructure.env`:

```sh
TCG_TAILSCALE_AUTH_KEY="YOUR_SERVER_BOOTSTRAP_KEY"
```

This key registers the Droplet. It does not change the Mac's Tailscale login.
If it expires before use or has already been consumed when a new registration is
needed, create a replacement with the same settings.
[Tailscale server setup](https://tailscale.com/docs/how-to/set-up-servers).

## 8. Describe your existing DigitalOcean resources

The Droplet must run **Debian 13 on x86_64**, and the database must be PostgreSQL.
Both must share the VPC used for the private database connection.

Copy the template once; edit your existing file if you already copied it:

```sh
cp infra/environments/production/terraform.tfvars.example \
  infra/environments/production/terraform.tfvars
vim infra/environments/production/terraform.tfvars
```

Fill in the values from the existing resources in DigitalOcean:

| Setting                 | Value to use                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `existing_droplet_id`   | Numeric ID from the Droplet's page URL                                                              |
| `existing_database_id`  | Cluster UUID from the database's page URL                                                           |
| `region`                | Their current region                                                                                |
| `droplet`               | Current name, size, and VPC UUID; keep the template's Debian image and `ssh_keys = []` for adoption |
| `database`              | Current name, PostgreSQL version, size, node count, and VPC UUID                                    |
| `application_database`  | The logical database your application already uses, such as `defaultdb`                             |
| `admin_ipv4_cidrs`      | Public administrator IPv4 addresses allowed to SSH, each with `/32`                                 |
| `database_client_ipv4s` | All external database clients to keep, including the currency collector Mac; no `/32` suffix        |
| `bucket_name`           | A new, globally unique bucket name                                                                  |

Check the Mac mini's public outbound IPv4 from its terminal:

```sh
curl -4 https://api.ipify.org
```

Use that address for the Mac's access rules. Preserve other required clients too.
Leave `enable_storage_ip_restriction = false` and `api_hostname = ""`.
Replace every example address and placeholder. Do not create a replacement Droplet
or database.

## 9. Confirm administrative SSH access

You need your existing administrative SSH key, separate from `deploy-key`.

In the DigitalOcean Droplet console, run:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

From the Mac mini, connect to `root@YOUR_DROPLET_PUBLIC_IP`. Verify the offered
host-key fingerprint against the console before accepting it. If SSH offers a
different key type, verify that key's fingerprint in the console instead.
Make sure this login works with the administrative key available to SSH before
continuing. Keep the verified host-key entry in the Mac's normal `known_hosts` file.

## 10. Review and apply the infrastructure

```sh
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" infra-init
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" infra-plan
```

Read the plan privately. The existing Droplet and database must be preserved.
New resources should include the private bucket, storage key, and host firewall.
Stop and correct unexpected changes before applying.

Once satisfied, apply that saved plan:

```sh
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" infra-apply
```

## 11. Configure the Droplet

```sh
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" infra-configure
```

This installs the server configuration and registers the Droplet in Tailscale.
Confirm the Droplet appears in your tailnet with `tag:tcg-server`.

## 12. Save the release connection

Create `$HOME/.config/tcg/release.env` with these settings:

```sh
TCG_DEPLOY_HOST="YOUR_DROPLET_FULL_TAILSCALE_HOSTNAME"
TCG_DEPLOY_KEY="$HOME/.config/tcg/deploy-key"
TCG_KNOWN_HOSTS="$HOME/.config/tcg/deploy-known-hosts"
TCG_IMAGE_REPOSITORY="ghcr.io/YOUR_LOWERCASE_OWNER/YOUR_LOWERCASE_REPOSITORY-server"
```

Use the same image repository as step 6. In the trusted Droplet console, display:

```sh
cat /etc/ssh/ssh_host_ed25519_key.pub
```

Create `$HOME/.config/tcg/deploy-known-hosts` with one line containing the exact
Tailscale hostname from `TCG_DEPLOY_HOST`, followed by the key type and key from
that output:

```text
YOUR_DROPLET_FULL_TAILSCALE_HOSTNAME ssh-ed25519 YOUR_DROPLET_HOST_PUBLIC_KEY
```

This is the **Droplet's host key**, separate from your deployment public key.

```sh
chmod 600 "$HOME/.config/tcg/release.env" "$HOME/.config/tcg/deploy-known-hosts"
```

Setup is complete. Choose **[release from the Mac mini](release.md)** or
**[release with GitHub Actions](github-actions.md)**. Neither requires uploading
an image manually. The first release is private; it will not create a public API URL.

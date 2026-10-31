# DigitalOcean deployment

[Back to server README](../README.md)

Use the [infrastructure and release guide](../../infra/README.md) for the complete
setup. Infrastructure configuration lives in `infra/`; application runtime files
live in `deploy/`. The guide covers adoption of an existing Droplet/database,
private Spaces storage, Docker, Tailscale, private testing without a domain,
reviewed infrastructure changes, and manually triggered GitHub releases.

The Debian 13 x86_64 Droplet and PostgreSQL cluster already created should be
imported, not replaced. Ansible adopts the Docker installation and makes host
configuration repeatable. Docker remains installed across SSH disconnects and
reboots; the daemon and application restart policy are managed by code.

The empty Space with the malformed `/32` deny policy was deleted. Create its
replacement through Terraform using a new globally unique name. Do not repeat
the earlier manual blanket-deny policy: source-IP restriction starts disabled,
is derived from the Droplet resource when enabled, and preserves credentialed
policy-management access for recovery.

The existing Mac [daily currency job](digitalocean-database.md) remains separate
and continues to use its private configuration file. Keep that Mac's public IP
in Terraform's database trusted-source inputs.

Start with the one-time account/credential setup in the guide, then:

```sh
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" infra-init
just --dotenv-path "$HOME/.config/tcg/infrastructure.env" infra-plan
```

Review the plan before running `infra-apply`. Routine releases use GitHub
**Actions → Release server → Run workflow** after the workflows are merged into
main and the host has been configured. No live infrastructure is changed merely
by adding these files to the repository.

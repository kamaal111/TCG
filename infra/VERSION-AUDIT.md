# Infrastructure version audit

Audit date: 2026-10-31. Scope: the infrastructure/deployment additions in this
PR, including their Python dependency graph and GitHub Actions references.
Application dependencies are outside this audit. Shared action references in
existing CI jobs use the same audited releases as the new workflows.

Tool selections use the newest stable version compatible with their consumers,
with at least 24 hours since release. Prereleases are excluded. GitHub Actions
use **major release tags**, as requested, consistently across workflows. The
release versions below record the audit snapshot; action maintainers advance
major tags independently of the pinned tool/dependency graph.

| Component                  | Before audit                  | Audited selection             | Reason                                                                     |
| -------------------------- | ----------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| Controller Python          | 3.13                          | 3.14 (validated with 3.14.10) | Newest supported minor for stable Ansible 2.21                             |
| uv                         | 0.13.5                        | 0.13.6                        | Latest stable patch                                                        |
| Terraform                  | 1.17.1                        | 1.17.1                        | Already latest stable                                                      |
| DigitalOcean provider      | 2.106.0                       | 2.106.0                       | Already latest stable; Linux/macOS checksums retained                      |
| ansible-core               | 2.21.5                        | 2.21.5                        | Already latest stable; graph locked by mise for the Python 3.14 controller |
| Caddy                      | 2.11.7                        | 2.11.7                        | Already latest stable                                                      |
| actionlint                 | 1.7.12                        | 1.7.12                        | Already latest stable                                                      |
| actions/checkout           | v7                            | v7 (audited release v7.0.1)   | Same exact release across workflows                                        |
| pnpm/setup                 | v3                            | v3 (audited release v3.1.2)   | Same exact release across workflows                                        |
| extractions/setup-just     | v4                            | v4                            | Already latest stable                                                      |
| Tool setup actions         | Separate Terraform/uv actions | jdx/mise-action v5            | One tool owner; maintained major tag                                       |
| actions/upload-artifact    | v6                            | v7 (audited release v7.0.2)   | Latest stable upload action                                                |
| actions/download-artifact  | v7                            | v8 (audited release v8.0.2)   | Latest stable download action                                              |
| docker/setup-buildx-action | v3                            | v4 (audited release v4.4.1)   | Current stable action and Node 24 runtime                                  |
| docker/login-action        | v3                            | v4 (audited release v4.7.0)   | Current stable action and Node 24 runtime                                  |
| docker/build-push-action   | v6                            | v7 (audited release v7.4.0)   | Current stable action and Node 24 runtime                                  |
| tailscale/github-action    | v4                            | v4 (audited release v4.4.0)   | Use the maintained major tag                                               |
| Tailscale CI binary        | Action default                | 1.104.4                       | Explicit latest stable binary                                              |

The Droplet's Docker and Tailscale packages use their official stable Debian
repositories. Host configuration installs missing packages without silently
upgrading an already running host on every rerun. Host OS upgrades remain a
separate reviewed maintenance operation. The server's Node/pnpm versions reuse
the existing repository configuration rather than introducing a second version
selection in deployment files.

The finalized mise-managed Python graph contains nine packages; OSV reported
zero advisories on the audit date. This does not imply
a complete vulnerability assessment of operating-system/container packages or
third-party action implementations. Release metadata verifies versions and
support; it is not a substitute for testing. Live cloud apply, private-network
acceptance, and reboot recovery still require configured accounts and credentials.

## Sources

- [Ansible Python support matrix](https://docs.ansible.com/projects/ansible-core/devel/reference_appendices/release_and_maintenance.html#ansible-core-support-matrix)
- [Ansible releases on PyPI](https://pypi.org/project/ansible-core/)
- [uv releases](https://github.com/astral-sh/uv/releases)
- [uv release-age setting](https://docs.astral.sh/uv/reference/settings/#exclude-newer)
- [Terraform releases](https://github.com/hashicorp/terraform/releases)
- [DigitalOcean provider releases](https://registry.terraform.io/providers/digitalocean/digitalocean/latest)
- [Caddy releases](https://github.com/caddyserver/caddy/releases)
- [actionlint releases](https://github.com/rhysd/actionlint/releases)
- [Checkout releases](https://github.com/actions/checkout/releases)
- [pnpm setup releases](https://github.com/pnpm/setup/releases)
- [just setup releases](https://github.com/extractions/setup-just/releases)
- [mise action releases](https://github.com/jdx/mise-action/releases)
- [mise Python tool locking](https://mise.jdx.dev/dev-tools/backends/pypi.html)
- [Artifact upload releases](https://github.com/actions/upload-artifact/releases)
- [Artifact download releases](https://github.com/actions/download-artifact/releases)
- [Docker Buildx setup releases](https://github.com/docker/setup-buildx-action/releases)
- [Docker login releases](https://github.com/docker/login-action/releases)
- [Docker build/push releases](https://github.com/docker/build-push-action/releases)
- [Tailscale action releases](https://github.com/tailscale/github-action/releases)
- [Tailscale releases](https://github.com/tailscale/tailscale/releases)
- [OSV vulnerability database](https://osv.dev/)

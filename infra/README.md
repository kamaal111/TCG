# Server releases

Run commands on the **Mac mini**, from the repository root. The application runs
on the **DigitalOcean Droplet**.

1. **[Prepare the release flow](setup.md)** — do this once.
2. **[Release from the Mac mini](release.md)** — use this for each local release.
3. **[Release with GitHub Actions](github-actions.md)** — set up Actions, then release from GitHub.

Start with a private release; a domain is not required. It will not expose a public API.

[Maintenance and technical reference](reference.md) covers token renewal,
infrastructure workflows, public HTTPS, storage restrictions, and recovery.

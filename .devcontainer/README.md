# TCG Dev Container

A Linux environment for the server, the JS tooling and Swift formatting. Xcode builds and simulator
tests still run on the Mac.

## Usage

From the repository root on the host (after `just prepare`):

| Recipe                              | What it does                                                             |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `just devcontainer-up` (`dc-up`)    | Create or start this checkout's dev container                            |
| `just devcontainer-shell` (`dc-sh`) | Open zsh inside it                                                       |
| `just devcontainer-exec <cmd>`      | Run a command inside it, e.g. `just devcontainer-exec just ready-server` |
| `just devcontainer-stop`            | Stop the container and its services, keeping data                        |
| `just devcontainer-rebuild`         | Recreate the container, keeping volumes                                  |
| `just devcontainer-delete`          | Remove the container, services and their volumes                         |

VS Code (**Dev Containers: Reopen in Container**) and Zed open the same configuration.

## What's inside

- Node, Swift, pnpm and just, installed by [mise](https://mise.jdx.dev) from the `mise.toml` at the
  repository root, the single manifest for every language and tool version this project needs.
- Claude Code and Codex, installed by npm on top of that Node.
- Docker CLI, for the server's testcontainers and for the sidecars below.
- PostgreSQL (`db:5432`) and Garage (`garage:3900`) sidecars, already initialized.
  `DATABASE_URL` and `OBJECT_STORAGE_ENDPOINT` point at them, overriding `.env`.
- Server tests start their own containers through the host Docker daemon.

`just quality`, `just format`, `just ready-server` and `just dev-server` work inside. App tests,
`just ready-app` and `just ready` need Xcode, so run them on the Mac.

## Worktrees

Every checkout gets its own compose project: its own container, database, object storage and
`node_modules` volumes. Herdr worktrees reuse their `COMPOSE_PROJECT_NAME`; other checkouts get a
name derived from their path. The workspace and the shared git directory are mounted at their host
paths, so worktree `.git` links resolve.

Only the API port is published, on `127.0.0.1:$PORT` from the checkout's `.env`, so the iOS
simulator and host tools reach `just dev-server` at the same URL as without a container. Checkouts
need distinct `PORT` values to run side by side; `just herdr-worktree` assigns them, and
`devcontainer-up` refuses to start when the port is taken.

## Agent configuration

- Claude Code's login and settings live in the `tcg-devcontainer-claude` volume, shared by every
  checkout and kept by `devcontainer-delete`. Host `~/.claude/skills` and `~/.claude/plugins` are
  mounted read-only.
- Codex uses the host `~/.codex`.
- Git uses the host `~/.gitconfig`, read-only.

## Updating tool versions

Change versions in `mise.toml`, then `just devcontainer-exec mise install`, or `devcontainer-rebuild`
to start clean. Keep the `node` entry in sync with `.node-version` and `pnpm` with
`devEngines.packageManager`; the container fails to set up when Node drifts. After changing
features (not `mise.toml`), refresh the lockfile with `pnpm exec devcontainer upgrade --workspace-folder .`.

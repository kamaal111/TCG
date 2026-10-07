# TCG Dev Container

A Linux environment for the server, the JS tooling and Swift formatting. Xcode builds and simulator
tests still run on the Mac.

## Usage

From the repository root on the host (after `just prepare`):

| Recipe                                         | What it does                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `just devcontainer-up` (`dc-up`)               | Create or start this checkout's dev container                                                  |
| `just devcontainer-shell` (`dc-sh`)            | Open zsh inside it                                                                             |
| `just devcontainer-exec "command"` (`dc-exec`) | Start it and run a quoted command inside it, e.g. `just devcontainer-exec "just ready-server"` |
| `just devcontainer-stop`                       | Stop the container and its services, keeping data                                              |
| `just devcontainer-rebuild`                    | Recreate the container, keeping volumes                                                        |
| `just devcontainer-delete`                     | Remove the container, services and their volumes                                               |

VS Code (**Dev Containers: Reopen in Container**) and Zed open the same configuration.

Run commands from the host with `just dc-exec "just format"`. The recipe checks for this checkout's
running container and skips startup when it is already running. Otherwise, it starts the container
and services before executing the command with zsh in the container workspace. Pass the
whole command as one quoted argument; separate command arguments are not supported. Command output
and exit status are forwarded to the host, and a startup failure prevents command execution.

The same recipe works inside the devcontainer. When `TCG_DEVCONTAINER` is set, it executes the
command directly with zsh in the workspace, skipping Docker detection and startup.

Use single outer quotes when variables or shell expressions should be evaluated inside the container:

```sh
just dc-exec 'printf "%s\n" "$TCG_DEVCONTAINER"'
just dc-exec 'printf "%s\n" "hello world" && pwd'
```

`just dc-sh` opens an interactive shell and takes no command arguments.

## What's inside

- Node, Swift and pnpm, installed into the image by [mise](https://mise.jdx.dev) from the
  `mise.toml` at the repository root. They are available before editor lifecycle commands run.
- `just`, installed by its own devcontainer feature rather than `mise.toml`. Feature versions
  and digests are recorded in `devcontainer-lock.json`; the binary version is not checked by
  the repository's version-sync script.
- Zsh autosuggestions and syntax highlighting, installed from Debian packages in the image.
- Claude Code and Codex, installed into the image by their official native installers.
  Their launchers are available through `/root/.local/bin`.
- GitHub Copilot Chat, included in the VS Code extension configuration.
- Docker CLI, for the server's testcontainers and for the sidecars below.
- PostgreSQL (`db:5432`) and Garage (`garage:3900`) sidecars, already initialized.
  `DATABASE_URL` and `OBJECT_STORAGE_ENDPOINT` point at them, overriding `.env`.
- Server tests start their own containers through the host Docker daemon.

`just quality`, `just format`, `just ready-server` and `just dev-server` work inside. App tests,
`just ready-app` and `just ready` need Xcode, so run them on the Mac.

VS Code can install Docker credential helpers that depend on its editor session. The production
server-image build uses a private temporary Docker configuration inside the devcontainer when those
helpers are present, omitting only `dev-containers-*` helper references. This lets
`just dc-exec "just ready-server"` build its public base images independently of VS Code. Other
credentials, helpers, Docker settings and supporting files remain available. The temporary
configuration is removed after the build; the original configuration and credential forwarding for
other commands remain unchanged. Authentication available only through the editor helper is not
used for this build.

## Worktrees

Every checkout gets its own compose project: its own container, database, object storage and
`node_modules` volumes. Herdr worktrees reuse their `COMPOSE_PROJECT_NAME`; other checkouts get a
name derived from their path. The workspace and the shared git directory are mounted at their host
paths, so worktree `.git` links resolve.

The API port is published on `127.0.0.1:$PORT` from the checkout's `.env`, so the iOS
simulator and host tools reach `just dev-server` at the same URL as without a container. Checkouts
need distinct `PORT` values to run side by side; `just herdr-worktree` assigns them, and
`devcontainer-up` refuses to start when the port is taken.

PostgreSQL is published on `127.0.0.1:${TCG_DB_PORT:-5432}`. Host tools such as Postico can
connect without an editor tunnel. With the default credentials and port, use
`postgresql://tcg_user:tcg_password@127.0.0.1:5432/tcg`. For a worktree, use its `TCG_DB_PORT`
from `.env` instead of `5432`; `just herdr-worktree` assigns distinct database ports too.
Connections inside the dev container continue to use `db:5432`. After changing the port
configuration, run `just devcontainer-up` from the host to apply it, preserving database data.

The editor configuration can additionally forward `garage:3900`; this is an editor tunnel,
not a Compose-published host port.

## Agent configuration

- Claude Code's login and settings live in the `tcg-devcontainer-claude` volume, shared by every
  checkout and kept by `devcontainer-delete`. Host `~/.claude/skills` and `~/.claude/plugins` are
  mounted read-only.
- Codex uses the host `~/.codex` for login and settings. Its Linux package is installed under
  `/opt/tcg-codex`, outside that mount.
- Git uses the host `~/.gitconfig`, read-only.

## Updating tool versions

Run `just devcontainer-rebuild` from the host to apply installer or extension configuration
changes. Claude Code installs from the `latest` channel and automatically updates in the
background; run `claude update` inside the container to update immediately.

To update Codex inside the container, rerun its installer with the same installation-scoped
home so the Linux package stays outside the host configuration mount:

```sh
curl -fsSL https://chatgpt.com/codex/install.sh -o /tmp/install-codex.sh \
  && CODEX_NON_INTERACTIVE=1 CODEX_HOME=/opt/tcg-codex \
     sh /tmp/install-codex.sh \
  && rm /tmp/install-codex.sh
```

Change versions in `mise.toml`, then run `just devcontainer-rebuild` from the host to update the
image. Keep the `node` entry in sync with `.node-version`, `pnpm` with
`devEngines.packageManager`, and `swift` with every `Package.swift`'s `swift-tools-version`;
also update the Node and pnpm defaults in the root `Dockerfile`, plus the Node and Swift paths
in `devcontainer.json`'s VS Code settings. `just quality`
runs `just check-versions` to catch drift, and the container fails to set up when Node drifts.
`just` isn't tracked in `mise.toml` — it comes from its own feature. After changing features
(not `mise.toml`), refresh the lockfile with
`pnpm exec devcontainer upgrade --workspace-folder .`.

`postCreateCommand` installs workspace dependencies into the checkout's `node_modules` volumes.
If an editor skips that command, the first `just prepare-server` or `just dev-server` installs
them before running server work.

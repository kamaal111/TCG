# TCG Repository Guide

## Required Codex Plugin

Install **Kamaal Super Mind** before working in this repository:

```sh
curl -fsSL https://raw.githubusercontent.com/kamaal111/kamaal-super-mind/main/install.sh | bash
```

Start a new Codex task afterward and confirm installation with `codex plugin list`.

## Project Workflow

- Run `just` from the repository root before working to discover the available recipes.
- Run commands from the repository root unless a recipe specifies another directory.
- Use `pnpm` for Node.js work and `uv run` for Python code that needs project packages.
- Prefer root `just` recipes for project workflows; do not start the server directly or in the background. Use `just dev-server` only when explicitly asked to start it.
- For TCG Swift-client endpoint work, use the repository-local `tcg-client-endpoint` skill alongside the relevant Kamaal Super Mind skills.

## Verification

- For code changes, run `just ready` last; do not claim completion until it passes.
- For documentation-only changes, skip `just ready` unless explicitly requested.
- Use `just lint`, `just format-check`, `just typecheck`, and `just test` as the relevant narrower checks while iterating.

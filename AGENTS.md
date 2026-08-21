# TCG Repository Guide

## Project Workflow

- Run `just` from the repository root before working to discover the available recipes.
- Run commands from the repository root unless a recipe specifies another directory.
- Use `pnpm` for Node.js work and `uv run` for Python code that needs project packages.
- Prefer root `just` recipes for project workflows; do not start the server directly or in the background. Use `just dev-server` only when explicitly asked to start it.
- Never invoke iOS `xcodebuild` tests directly. Use `just test-app-ios` or `just test-snapshots-ios`; these recipes serialize access to the shared CoreSimulator device across agents.
- Agents must run recipes that include iOS simulator tests outside any filesystem sandbox. The simulator wrapper intentionally fails before launching CoreSimulator when the required access is unavailable.
- For TCG Swift-client endpoint work, use the repository-local `tcg-client-endpoint` skill alongside the relevant Kamaal Super Mind skills.
- Before adding or changing a server log line, read `server/docs/logging.md`; events and fields are declared per domain and enforced by the type checker.

## Verification

- Run `just quality` first while iterating; it surfaces lint/format/typecheck failures faster than waiting for a `ready` recipe to fail.
- For code changes, run the matching `ready` recipe last; do not claim completion until it passes: `just ready-server` when only the server changed, `just ready-app` when only the app changed, and `just ready` only when the changes span both.
- For documentation-only changes, skip the `ready` recipes unless explicitly requested.
- Use `just lint`, `just format-check`, `just typecheck`, and `just test` as the relevant narrower checks while iterating.

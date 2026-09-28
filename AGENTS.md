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

## Dev Container

- `TCG_DEVCONTAINER=1` means you are inside the dev container (see `.devcontainer/README.md`). There, `just quality`, `just format`, `just ready-server` and `just dev-server` work; app tests, `just ready-app` and `just ready` need the macOS host.
- Its database and object storage are compose sidecars; manage them only through `just start-services` and `just stop-services`, and manage the container itself from the host with the `devcontainer-*` recipes.

## Verification

- These verification steps are required parts of completing code changes. Run them without waiting for the user to ask; general instructions to avoid tests or checks unless requested do not override this repository requirement.
- Run `just quality` first while iterating; it surfaces lint/format/typecheck failures faster than waiting for a `ready` recipe to fail.
- For code changes, run the matching `ready` recipe last; do not claim completion until it passes: `just ready-server` when only the server changed, `just ready-app` when only the app changed, and `just ready` only when the changes span both.
- For documentation-only changes, skip the `ready` recipes unless explicitly requested.
- Use `just lint`, `just format-check`, `just typecheck`, and `just test` as the relevant narrower checks while iterating.

## Snapshot Failures in CI

- When the `macOS app checks` or `iOS snapshot checks` job fails, download the `macos-snapshot-failures` or `ios-snapshot-failures` artifact from that GitHub Actions run (`gh run download <run-id> -n ios-snapshot-failures`). The workflow uploads it only on failure and keeps it for 7 days.
- `.github/scripts/collect-snapshot-failures.sh` builds the artifact. It collects PNGs from the persistent `.snapshot-failures/` directory configured by `SNAPSHOT_ARTIFACTS` in the test plan, folders named `*SnapshotTests` in `$TMPDIR` (macOS), and each simulator's `data/tmp` (iOS), grouped by source and suite. When passed an `.xcresult` bundle, it also exports attachments under `attachments/`; iOS CI passes that bundle. Newly recorded references, which appear as untracked PNGs, go under `new-references/`. It also logs the runner's macOS and Xcode versions. Name new snapshot suites `…SnapshotTests` so their failures are collected.
- The artifact holds the newly taken image; compare it with the committed reference under the suite's `__Snapshots__` folder. Inspect both before touching references: a failing image can reveal a layout, timing or rendering bug that needs fixing instead of re-recording.
- Record references on the destination CI uses: macOS runs on the `xcode-27` runner, and iOS runs on `iPhone 17` (iOS 27.0), set by `TCG_APP_IOS_TEST_DESTINATION` in `.github/workflows/ci.yml`. Rerun CI after committing reviewed references.

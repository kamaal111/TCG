---
name: gitbutler-workflows
description: Work safely with this repository when it is managed by GitButler. Use when creating branches, assigning changes, committing, amending commits, pushing, or opening pull requests through GitButler virtual branches.
---

# GitButler Workflows

Use this skill when the repository is on `gitbutler/workspace` or when the user explicitly asks for GitButler-based branch and commit operations.

## Core Model

- Treat `gitbutler/workspace` as GitButler's integration branch, not a normal branch to commit on.
- Do not use plain `git commit` on `gitbutler/workspace`.
- Prefer GitButler CLI commands through `but` for branch creation, staging, commit creation, commit rewriting, and pushing.
- Do not assume `but pr` is the best default for pull request creation in non-interactive Codex runs.
- Use plain `git` for read-only inspection when useful, but assume write operations on `HEAD`, branch refs, or the index can conflict with GitButler's model.

## Standard Flow

1. Run `but status -f` to inspect unassigned changes, staged changes, applied branches, and commit IDs.
2. If a suitable virtual branch already exists for the work, reuse it.
3. If not, create one with `but branch new <branch-name>`.
4. Move unassigned work onto the target branch with `but stage <file-or-hunk> <branch>`.
5. Create the commit with `but commit <branch> --only --message ...` when the branch already has the right staged changes.
6. Push with `but push <branch>`.
7. Open or update the review using the simplest authenticated path:
   - prefer the GitHub connector when available
   - otherwise prefer `gh pr create`
   - only prefer `but pr new <branch>` when GitButler forge auth is already configured and you intentionally want to stay entirely in GitButler

## Setup And Access

- Do not run `but setup` routinely. In normal local usage, GitButler setup should only be needed once per repository.
- Treat `but status -f` as the first health check. If it can read branch and workspace state, prefer proceeding directly with the requested GitButler mutation.
- If a write command such as `but stage`, `but commit`, `but amend`, or `but reword` fails with errors like `unable to open database file`, `Could not create named temp file`, or similar workspace database/temp-file failures, first suspect sandbox or filesystem permissions rather than missing setup.
- In that case, retry the same command with the required elevated access before reaching for `but setup`.
- Use `but setup` only when there is evidence the repository is not actually registered or configured in GitButler, or when a retry still indicates a genuine setup problem.

## Branching Rules

- Prefer one virtual branch per user-visible task.
- If `but status` already shows a branch lane that matches the work, do not create a duplicate branch.
- Use `but branch new <branch-name> --anchor <branch-or-commit>` only when the user clearly wants stacked work.

## Commit Rewrites

- When the user wants additional work included in an existing commit, do not create a follow-up fixup commit by default.
- Use `but status -f` to get the file ID for the new change and the short commit ID for the target commit.
- Amend the change into the existing commit with `but amend <file-id> <commit-id>` or the equivalent `but rub <file-id> <commit-id>`.
- For commit-message-only rewrites, prefer `but reword <sha> -m "<message>"`.
- Use `but reword <sha>` without `-m` when you want to edit the message in an editor and let GitButler rebase dependent work automatically.
- If `but reword` fails because GitButler cannot open the workspace database or create temporary files, retry with elevated access first.
- Only run `but setup` after that when the failure still points to actual missing repository setup.
- If GitButler still cannot complete the rewrite, stop and surface the failure clearly instead of silently switching to plain Git history edits.
- After rewriting a pushed commit, push the branch again and expect a force update.

## PR Notes

- Treat PR creation as a separate auth surface from GitButler staging/commit/push.
- `but pr` requires GitButler forge authentication.
- `gh pr create` requires a valid `gh auth status`.
- Before choosing a PR path, check the available auth once instead of discovering it by failure after multiple attempts.
- In non-interactive Codex runs, prefer the GitHub connector or `gh pr create` by default because they are simpler and more predictable than `but pr`.
- Use `but pr new` only when forge auth is already configured and you want GitButler to own the review creation step.
- If you do use `but pr new` in non-interactive mode, always pass one of `--message`, `--file`, or `--default`.
- If `but pr` fails because no authenticated forge user is configured, keep the GitButler branch and commit flow intact and switch to the available GitHub tooling only for the PR creation step.
- If `gh auth status` is invalid, either use the GitHub connector or stop and ask the user to re-authenticate with `gh auth login`.
- Reuse the commit message as the PR body when the user asks for a single source of truth.

## Checking Out PRs For Testing

- When the user asks to test a PR locally, first fetch the PR head into a stable local remote-tracking ref:
  - `git fetch origin pull/<number>/head:refs/remotes/origin/pr/<number>`
  - If the fetch is rejected as non-fast-forward, the PR was probably force-pushed; refetch with a leading `+`:
    `git fetch origin +pull/<number>/head:refs/remotes/origin/pr/<number>`
- Before changing the worktree, verify branch and cleanliness with `git status --short --branch`, and compare `HEAD` with `origin/pr/<number>` using `git rev-parse HEAD origin/pr/<number>`.
- Prefer GitButler-native application first when the repository is on `gitbutler/workspace`:
  - Try `but branch list -j` or `but status -j` to find the branch name GitButler recognizes.
  - Prefer applying a real local branch name when one exists, for example `but apply codex/example-branch`.
  - Be cautious with raw PR refs such as `origin/pr/<number>` or GitButler's synthetic `pr/<number>` branch names; in this repository they have triggered GitButler CLI panics or stale workspace state.
- If `but apply`, `but unapply`, or `but pick` fails because of malformed stack metadata, do not discard or rewrite local commits just to make a testing checkout work.
  - Known symptoms include `insertion index ... should be <= len`, `Stack for '<id>' not found in workspace`, or `Currently cherry-apply only works with stacks that have ids`.
  - In that case, use a plain Git testing branch as the safe fallback:
    `git switch -c codex/test-pr-<number>-latest origin/pr/<number>`
  - If a previous testing branch exists and the PR was force-pushed, create a fresh branch at the new PR head rather than resetting the old branch unless the user explicitly asks to discard it.
- If Git refuses to switch because the exact branch is already checked out in another worktree, create a differently named local testing branch at `origin/pr/<number>`.
- After checkout, prove the workspace matches the PR with:
  - `git status --short --branch`
  - `git branch --show-current`
  - `git rev-parse HEAD origin/pr/<number>`
  - `git diff --quiet HEAD origin/pr/<number>`
- Tell the user clearly when the result is a plain Git checkout rather than an applied GitButler virtual branch. Git may print that the workspace left GitButler mode and that `but setup` is needed to return.

## Safety Checks

- Before mutating anything, verify whether unassigned changes exist in `zz` and whether they belong to the requested branch.
- Avoid switching to normal git branches unless the user explicitly wants to leave GitButler mode.
- If you need to inspect branch state after a push or amend, rerun `but status -f`.

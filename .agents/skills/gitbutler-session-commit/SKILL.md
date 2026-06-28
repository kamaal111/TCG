---
name: gitbutler-session-commit
description: Commit the changes from the current Codex session into a GitButler virtual branch. Use when the user asks to commit recent/session changes, create a GitButler branch if one was not named, assign changes to that branch, write a review-friendly commit message, or use GitButler instead of plain git for branch and commit operations.
---

# GitButler Session Commit

## Overview

Commit only the intentional changes from the current session through GitButler.
If the user did not name a branch, create or reuse a task-specific GitButler
virtual branch before staging and committing.

## Required Skills

Load and follow these skills when they are present in the repository:

- `gitbutler-workflows` for all GitButler branch, staging, commit, amend,
  push, and PR mechanics.
- `commit-message-best-practices` before writing the commit message.
- `testing-best-practices` when deciding whether the session changes have
  already been verified enough to commit.
- Domain skills that match the touched files, such as `kowalski-server-typescript`,
  `kowalski-app-swift`, or `kowalski-dependency-upgrade`, when validation or
  scope decisions depend on those domains.

If a required skill path listed in `AGENTS.md` is missing, say so briefly and
continue with the closest local workflow.

## Workflow

1. Inspect the repository instructions first. In Kowalski, run `just` from the
   repository root before choosing commands.
2. Confirm the current GitButler state with `but status -f`. Use read-only
   `git status --short` or `git diff` only to understand scope.
3. Identify the changes made in the current session. Do not stage unrelated
   user work. If the worktree mixes unrelated edits and the intended scope is
   unclear, stop and ask the user which files belong in the commit.
4. Choose the target virtual branch:
   - If the user named a branch, use that branch.
   - If `but status -f` shows an existing applied branch that clearly matches
     the session work, reuse it.
   - Otherwise create a concise kebab-case branch with `but branch new <name>`.
     Prefer a name derived from the completed task, such as
     `skill-gitbutler-session-commit`.
5. Stage only the session changes onto the target branch with `but stage`.
   Prefer file-level staging when the whole file belongs to the session; use
   hunk/file IDs from `but status -f` when only part of a file belongs.
6. Inspect the staged diff and write the commit message using
   `commit-message-best-practices`. Follow any repository-specific commit body
   format in `AGENTS.md`.
7. Commit with GitButler, not plain git. Use `but commit <branch> --only
--message ...` after the branch has exactly the intended staged changes.
8. Push only when the user asks to publish/push/open a PR. If pushing, follow
   `gitbutler-workflows` and report the pushed branch.
9. After staging, committing, creating a branch, or pushing, include the
   corresponding Codex git directive in the final response when the action
   succeeded.

## Validation Expectations

Do not claim a code session is ready to commit until the relevant verification
has run or the user explicitly accepts committing unverified work. In Kowalski:

- Run the narrowest useful checks while iterating.
- Run `just ready` last for code changes.
- Skip `just ready` for docs-only changes unless the user asks for it.
- Include proof of validation in the final response.

If validation fails, fix the issue and rerun it before committing unless the
user explicitly tells you to commit the failing state.

## Safety Rules

- Never use plain `git commit` on `gitbutler/workspace`.
- Never run destructive git commands to isolate changes.
- Never include files just because they are modified; include only the changes
  that belong to the completed session.
- Retry GitButler write commands with elevated permissions if they fail with
  workspace database or temporary-file permission errors before assuming setup
  is broken.
- Do not open a PR as part of this skill unless the user asks for it.

---
name: gh-actions-log-debug
description: Use when a pull request or branch has failing GitHub Actions checks and you need to debug them self-sufficiently with the GitHub CLI. Resolve the current branch PR, inspect failing checks, pull failing-step logs for the current SHA, summarize the root cause, implement a fix, and preserve a single-commit branch with amend plus force-push when requested.
---

# GitHub Actions Log Debug

Use this skill when CI is failing and the task is to diagnose the problem directly from GitHub Actions without waiting for someone else to paste logs.

## Quick start

- Verify `gh` is installed: `gh --version`
- Verify auth: `gh auth status`
- Inspect the current branch PR:
  - `python .agents/skills/gh-actions-log-debug/scripts/inspect_pr_failures.py --repo .`
- Inspect a specific PR:
  - `python .agents/skills/gh-actions-log-debug/scripts/inspect_pr_failures.py --repo . --pr 15`

## Workflow

1. Confirm GitHub CLI access.
   - Run `gh auth status`.
   - If auth or scopes are missing, stop and tell the user exactly what is blocked.
2. Pull failing CI context from GitHub.
   - Use the bundled script first.
   - The script resolves the PR, reads `gh pr checks`, maps failing checks to workflow runs for the PR head SHA, and fetches `gh run view --log-failed` output.
3. Summarize the failure before changing code.
   - Identify the failing job name, run URL, and the smallest useful log snippet.
   - Say when a match is ambiguous or when logs are incomplete.
4. Fix the root cause locally.
   - Prefer the smallest change that addresses the failing check.
   - Match existing repo patterns instead of introducing CI-only workarounds.
5. Verify the fix.
   - Run the most relevant command first.
   - For code changes in this repository, finish with `just ready`.
6. If the user wants to keep a single commit:
   - Stage only the intended files.
   - Run `git commit --amend --no-edit`.
   - Rerun verification on the amended tree if hooks may have changed files.
   - Push with `git push --force-with-lease origin <branch>`.

## Notes

- The script is intentionally GitHub Actions focused. External CI providers are report-only.
- Prefer `gh run view --log-failed` before `--log`; it is usually shorter and more actionable.
- If the current branch has no PR yet, pass `--pr` explicitly or inspect the current branch run list manually.

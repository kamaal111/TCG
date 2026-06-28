---
name: commit-message-best-practices
description: Write high-signal git commit messages and PR descriptions that match the actual final diff. Use when preparing commits, squashing history, or drafting reusable commit and PR text in this repository.
---

# Commit Message Best Practices

Use this skill when the user asks for a commit, a refined commit message, or a PR description that should be derived from the same change set.

## Goal

Produce a message that explains the meaningful product or logic change without narrating routine engineering hygiene.

## Workflow

1. Inspect the final staged and unstaged diff before writing anything.
2. Identify the real user-facing or logic-facing change.
3. Treat support work such as tests, formatting, dependency lockfile churn, or internal agent artifacts as secondary unless the user explicitly wants them called out.
4. If the commit message will also be reused as the PR description, write the body in complete Markdown prose that stands on its own.

## Title Rules

- Keep the title specific and factual.
- Keep every commit message line to 71 characters or fewer.
- Summarize the main behavior or logic change, not the tools used to implement it.
- Avoid vague titles such as `fix stuff`, `refactor code`, or `update tests`.

## Body Rules

- Prefer short sections with explicit bold headings when the user asks for structure.
- If the user requests `Summary` and `How It's Solved`, use exactly those headings.
- In `Summary`, describe the problem solved or outcome delivered.
- In `How It's Solved`, explain the core implementation approach and important logic choices.
- Do not spend body space on obvious baseline work such as running tests, formatting, linting, or generic cleanup unless that work is itself the change.

## Example

```text
Add Pokemon import retries for transient API failures

**Summary**
Import jobs no longer fail immediately when the upstream API times out.

**How It's Solved**
The importer now retries transient fetch errors with a short backoff
and only marks the job failed after the final attempt.
```

## Scope Discipline

- Match the message to the final commit, not an earlier partial diff.
- If the commit intentionally includes helper files such as plans or skills that should stay out of the message, omit them from the narrative unless the user explicitly asks to mention them.
- If the worktree mixes unrelated changes, separate them before writing the message whenever possible.

## Reuse For PRs

- When asked to reuse the commit message as the PR description, write the body as valid Markdown with clean paragraphs and headings.
- Ensure the text can stand alone without extra terminal context.

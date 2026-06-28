---
name: dependency-upgrade-best-practices
description: Reusable workflow for upgrading dependencies safely. Use when auditing outdated packages, choosing candidate versions, updating manifests, regenerating lockfiles or resolved files, refreshing generated artifacts, validating the result, or investigating whether a target package version may be compromised.
---

# Dependency Upgrade Best Practices

## Overview

Apply this skill to upgrade dependencies in controlled batches, validate each batch, and carry breakage fixes through to the repository's final quality gate. Prefer deliberate, explainable upgrade steps over broad blind bumps.

## Start With Discovery

- Read the repository guidance, task runner, and manifests before changing versions.
- Inventory dependency surfaces separately when the repository has multiple package managers, subprojects, or generated artifacts.
- Group upgrades into sensible batches instead of applying a repo-wide bump by default.
- Call out packages that are likely to require code changes before updating them.

## Screen Candidate Versions First

- Do not upgrade to a version that is younger than the configured minimum release age in [config.json](./config.json) unless the user explicitly overrides that policy.
- Use the bundled scripts to shortlist candidate versions before editing manifests:
  - `scripts/list_npm_versions.py <package>` for npm package publish dates and age filtering
  - `scripts/list_swift_package_tags.py <repo-url>` for Swift package git tags and age filtering
  - `scripts/check_osv_advisories.py --package <name> --ecosystem <ecosystem> [--version <version>]` for quick advisory screening
- Prefer the newest stable version that satisfies the configured minimum release age and does not show suspicious security signals.

## Upgrade In Small Batches

- Update one surface at a time when the risk is high.
- Treat dependency manifests as the source of truth. Change files such as `package.json` or `Package.swift`, then use the package manager or build step to regenerate lockfiles, resolved files, and other generated artifacts.
- Do not hand-edit generated dependency state such as `pnpm-lock.yaml`, `Package.resolved`, or similar lock or resolution files.
- Prefer the repository's standard package manager commands over manual file edits when practical.
- Avoid mixing unrelated tooling, runtime, generator, and framework upgrades into one noisy pass unless the repository already manages them together.

## Investigate Compromise Signals

- Investigate whether the target package or version may have been compromised by a malicious actor before upgrading.
- Check current advisories, maintainer notices, registry warnings, GitHub security advisories, and recent reporting when the ecosystem supports them.
- Use primary or authoritative sources where possible, and treat a suspicious advisory or maintainer compromise report as a blocker until the user decides otherwise.
- If any version is suspected compromised, clearly state in chat:
  - the package name
  - the affected version or version range
  - why it is suspected to be compromised
  - the likely impact or behavior, if known
- Do not quietly upgrade through a suspected compromise incident.

## Validate Narrowly While Iterating

- Run the smallest useful compile, lint, typecheck, or test command for the surface you just changed.
- Build only the affected package or target when the change is isolated.
- Refresh generated artifacts only when the contract, generator, or dependency update requires it.
- Escalate to broader verification once the narrow surface is stable.

## Fix Breakages Instead Of Hiding Them

- Adapt code to new public APIs instead of immediately pinning versions back down.
- Do not suppress breakages with casts, `@ts-ignore`, lint disables, or warning downgrades.
- Update call sites, wrappers, schemas, and tests in the same pass when a dependency changes behavior.
- Stop expanding scope when the upgrade becomes noisy. Finish one breakage cluster before starting the next.

## Finish With Repository Verification

- Run the repository's aggregate verification command before declaring the upgrade complete.
- State clearly whether any failure came from code, generated artifacts, or environment setup.
- Avoid UI or end-to-end test suites unless the repository requires them or the user explicitly asks for them.

## Common Failure Patterns

- Framework or schema-library upgrades can change typing, validation, or middleware contracts.
- Generated-client upgrades can ripple into wrapper layers, view models, and tests.
- Compiler or language-toolchain upgrades can expose warnings that now fail builds.
- Lockfile-only changes can still break scripts, formatters, or test runners.

## Expected Output When Using This Skill

Finish by stating:

- which dependency batches you upgraded
- which breakages you fixed
- which commands you ran
- whether the repository's final verification passed, or why it did not

---
name: testing-best-practices
description: Cross-project guidance for planning, writing, debugging, and validating tests. Use when adding tests, fixing regressions, investigating failures, or checking whether a change is truly verified.
---

# Testing Best Practices

## Purpose

Use this skill to keep test work disciplined, reproducible, and aligned with the current repository.

Before writing or changing tests, identify the project's existing testing stack, helper utilities, naming conventions, and verification commands. Prefer repository-specific rules when they exist in files such as `AGENTS.md`, `README.md`, CI workflows, `package.json`, `pyproject.toml`, `justfile`, `Makefile`, or existing test files.

## Core Rules

1. **Test behavior first**: Prefer reproducing the bug or expected behavior with a failing test before changing production code.
2. **Do not guess verification**: Never claim a fix works until the relevant tests pass.
3. **Follow local conventions**: Match the repository's existing test structure, helper usage, naming, and assertion style.
4. **Keep tests deterministic**: Avoid uncontrolled time, randomness, network access, global state leakage, and order-dependent setup.
5. **Fail fast on setup issues**: When a setup step returns a status, value, or resource handle, verify it before continuing.
6. **Avoid comments in tests**: Use descriptive test names and clear assertions instead.
7. **Prefer the narrowest useful test**: Start with the smallest test scope that proves the behavior, then expand only when necessary.
8. **Honor stricter repo rules**: If the repository has stronger testing or verification requirements, those override this skill.

## First-Pass Repository Discovery

Before implementation, determine:

- Which test runner the project uses, such as Vitest, Jest, Bun test, Pytest, Go test, JUnit, or another framework
- Which helper utilities, fixtures, factories, or test base classes already exist
- Which commands are used for quick iteration and which command is the final quality gate
- Whether the project expects linting, type checking, coverage, or build verification in addition to tests
- Whether there are special setup requirements such as databases, containers, migrations, generated clients, or mock servers

Prefer the repository's command runner when one exists, such as `just`, `make`, `npm`, `pnpm`, `bun`, `cargo`, or language-native tooling.

## Test Design Workflow

### Red-Green-Refactor

1. Add or update a test that captures the expected behavior or reproduces the bug.
2. Confirm the test fails for the right reason when practical.
3. Make the smallest production change that makes the test pass.
4. Refactor only after the behavior is protected by tests.

### Scope Selection

- Use **unit tests** for isolated logic and pure transformations.
- Use **integration tests** when behavior depends on boundaries between modules, persistence, routing, or dependency wiring.
- Use **end-to-end tests** when the user flow cannot be validated well at a lower level.
- Cover the **happy path**, important **edge cases**, **error paths**, and any **regression scenario** that motivated the change.
- When a handler could otherwise return a misleading success payload, add regression coverage for the failure path and assert the explicit status code and error payload instead of only testing the happy path.

### Reliability

- Prefer fakes, stubs, or mocks over real external services unless the repository already relies on integration environments.
- Prefer shared default mock setup in the repository's global test harness over defining fresh mocks inside each test file.
- Give tests a small override surface for the few scenarios that need different responses, especially explicit error-path coverage, instead of rebuilding the whole mock locally.
- Control clocks, timers, randomness, and async scheduling when possible.
- Avoid sleeps and broad retries that hide race conditions.
- Keep assertions focused enough that a failing test points to one behavior.
- If a client library already accepts a transport object such as `URLSession`, mock at that boundary before adding a new production seam only for tests.
- If the code under test caches fetched results, disable or isolate that cache in tests so earlier responses cannot mask later failures.
- If a test helper uses shared mutable state, serialize that suite or otherwise isolate execution so parallel runs do not contaminate each other.

## Frontend Testing Guidelines

- Use the repository's preferred UI testing libraries and helpers.
- Prefer user-facing queries such as roles, labels, accessible names, and visible text over DOM traversal or CSS selectors.
- When UI tests need an accessibility hook, prefer a meaningful accessible label or name that also improves the real product experience, including VoiceOver.
- Do not add opaque test-only accessibility identifiers when a user-facing accessible name can serve the test.
- If an identifier is genuinely necessary, pair it with a real accessibility label/value and keep it human-readable rather than machine-ish.
- Prefer async-native queries such as `findBy*` over wrapping synchronous queries in polling helpers when the framework supports that distinction.
- Simulate realistic user interactions instead of calling component internals directly.
- Cover loading, empty, error, success, and permission-related states when applicable.
- Verify accessibility-relevant behavior when it is part of the feature, including labels, focus movement, and keyboard interaction.

## Backend and API Testing Guidelines

- Reuse the repository's existing app-construction, dependency-injection, or service-factory patterns when available.
- Reuse shared helpers for authentication, database setup, fixtures, and teardown.
- Prefer custom test fixtures over ad hoc `beforeEach` blocks when setup needs to hand tests reusable resources such as apps, database handles, sessions, or mock controllers.
- In this repository, prefer the `api/src/tests/fixtures.ts` integration fixture for API route, middleware, and error-path coverage instead of building bespoke Hono apps inside test files.
- When a real route can exercise middleware or exception behavior, cover it through that route first and only fall back to direct constructor or helper tests for code paths that genuinely have no fixture-backed route entrypoint.
- Assert response status, payload shape, side effects, and authorization behavior.
- Assert clear server failures for missing prerequisite data when the contract would otherwise look valid but be semantically wrong.
- Validate setup operations before using their outputs in later assertions.
- Keep test data minimal but representative of real behavior.

## Data and Persistence Testing Guidelines

- Use the repository's fixture, factory, or helper patterns for creating records.
- Assert persisted state after writes, not only returned values.
- Keep tests isolated through transactions, temporary databases, cleanup hooks, or other repo-standard mechanisms.
- When database creation is expensive, prefer one database instance or file per suite or worker and reset its contents between tests instead of recreating the whole database for every test.
- If the project requires migrations, containers, or generated artifacts, use the established setup flow instead of inventing a parallel path.

## Writing Maintainable Tests

- Name tests for observable behavior and conditions.
- Keep arrangement, action, and assertion stages easy to read through structure and naming.
- Avoid oversized tests that verify many unrelated behaviors at once.
- Extract shared helpers only after repetition is real and the abstraction improves clarity.
- When fixing a regression, keep at least one focused regression test that would have failed before the fix.

## Debugging Failing Tests

1. Reproduce the failure with the smallest relevant command first.
2. Read the full failure output before editing code.
3. Determine whether the problem is in production code, the test itself, or test setup.
4. If the failure is flaky, identify the uncontrolled dependency instead of adding retries or arbitrary waits.
5. When a type, interface, contract, or API changes, update all dependent tests in the same pass.

## Verification Workflow

1. Run the smallest relevant test target while iterating.
2. Run the broader package, module, or suite once local behavior looks correct.
3. Run every repository-required quality gate before declaring completion.
4. If the repository has a final aggregate verification command, run it last.

Examples of final verification commands vary by project and may include commands such as `just ready`, `make test`, `npm test`, `pnpm test`, `bun test`, `cargo test`, or a CI-equivalent workflow command.

## What to Inspect in a New Repository

- Existing `*.test.*`, `*.spec.*`, and `__tests__` patterns
- Project scripts and task runners
- Shared test utilities, fixture helpers, or custom render/request helpers
- CI workflows that reveal required commands and environment expectations
- Contributor docs and workspace instructions that add stricter rules

## Language and Framework Specifics

### Swift

See [SWIFT.md](./SWIFT.md) for Swift Testing conventions used in this repository, including:

- When to use backtick test function names (always) and why `@Test("description")` with camelCase is not used
- `@Suite` grouping conventions
- SwiftLint configuration for test directories
- Why `Result`-returning async APIs should usually be asserted through `.get()` plus `#require(throws:)` instead of `switch` statements with `Issue.record(...)` fallback branches
- When using `URLProtocol`-backed `URLSession` mocks, prefer `@Suite(..., .serialized)` if the handler state is shared across tests
- In this repository, recoverable negative-path tests can fail hard if they trigger `KamaalLogger(..., failOnError: true)` at error level, so treat log-level changes as test-impacting behavior

## Expected Output When Using This Skill

When applying this skill during a task, finish by clearly stating:

- what behavior is now covered by tests
- which tests or suites were run
- which final verification command passed
- any remaining gaps or follow-up work, if applicable

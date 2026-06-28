# Repository Guidelines

## Start Here

- Run `just` from the repository root first so you can discover the current command surface and prefer repo recipes over ad hoc commands.
- Run commands from the repository root unless a command explicitly requires a package directory.
- Look for existing patterns before writing code. Match surrounding structure, naming, validation, error handling, and test style unless there is a strong reason to introduce something new.
- Before copying non-trivial code, look for the right shared owner. Move reusable behavior into an appropriate service, model, utility, package, or module instead of keeping parallel implementations.

## Critical Development Rules

- **ALWAYS verify your work with relevant commands before claiming completion**
  - Run the narrowest useful checks while iterating.
  - Run `just ready` from the repository root as the final verification for code changes.
  - For docs-only changes, such as `AGENTS.md`, `README.md`, or skill files, do not run `just ready` unless the user explicitly asks for it.
- **NEVER claim code changes are done until `just ready` passes**
  - If `just ready` fails, fix the issues and rerun it until it succeeds.
- **ALWAYS use `pnpm` for Node.js work**
  - Do not use `npm` or `yarn` anywhere in this repository.
- **ALWAYS use `uv` for Python work**
  - If you need to run Python code with the project's required packages, run the script with `uv run`.
- **ALWAYS use root `just` commands when they exist**
  - Prefer repo recipes over custom command sequences for build, test, quality, database, and OpenAPI workflows.
- **NEVER start the server directly or as a background process**
  - Do not use `node ... &`, `pnpm start &`, `tsx ... &`, or similar patterns.
  - Only use `just dev-api` if the user explicitly asks you to start the server.
- **NEVER suppress lint or type errors**
  - Do not add lint-disable comments, `@ts-ignore`, or `@ts-expect-error`.
- **NEVER use TypeScript type assertions or casting**
  - Do not use `as Type` or `<Type>value`.
- **ALWAYS use the `testing-best-practices` skill for test changes**
  - Apply this skill whenever writing, maintaining, or modifying tests.
- **ALWAYS use the `commit-message-best-practices` skill for commit messages**
  - Apply this skill whenever drafting, refining, or reusing commit text.
- **ALWAYS use the `typescript-server-best-practices` skill for TypeScript server work**
  - Apply this skill whenever implementing, maintaining, or refactoring server-side TypeScript code.
- **ALWAYS use the `dependency-upgrade-best-practices` skill for dependency updates**
  - Apply this skill whenever upgrading, pinning, or auditing dependencies.
- **ALWAYS use the `gh-actions-log-debug` skill for CI failure triage**
  - Apply this skill whenever investigating or fixing GitHub Actions failures.
- **ALWAYS validate unknown or external data**
  - Use Zod at boundaries instead of forcing types through.
- **ALWAYS enforce user ownership when querying user-scoped resources**
  - Do not query by client-supplied resource IDs alone when the resource should belong to the authenticated user.
  - Scope reads and writes through the requesting user's owned parent record or an equivalent ownership constraint in the query itself.
  - Treat any uncertainty about ownership as a real security bug, not a follow-up cleanup.
- **NEVER hide required dependency failures behind misleading success responses**
  - If required derived data is missing, fail clearly instead of returning a superficially valid response that breaks downstream assumptions.
- **NEVER duplicate shared business logic across layers**
  - If two features need the same behavior, put it in the lowest suitable shared layer and depend on that layer.
  - Move/adapt the existing implementation instead of copying it and leaving the original behind.
  - Keep duplicated code only when the behavior is intentionally different, and make that distinction obvious in naming, structure, or tests.

## Final Response Verification Requirements

- **ALWAYS explain how you understood the goal in the final response**
  - State the outcome you believed the requester wanted so they can understand why you took the actions you took.
- **ALWAYS state any doubts, uncertainties, or issues discovered while working**
  - Do not hide concerns, tradeoffs, or problems under the rug. Surface them clearly so the requester can understand why certain actions were taken.
- **ALWAYS end the final response with complete proof of work showing the change works as expected**
  - Tell the user exactly how you validated the work.
  - Include every command, build, test, and manual check used as proof.
  - Be certain the verification is strong enough to prove the change works as expected, not just that code ran without obvious errors.
  - If you skipped validation, say so explicitly and why.

## Verification Commands

- Use `just lint` for linting changes.
- Use `just format` or `just format-check` for formatting changes.
- Use `just typecheck` for TypeScript type changes.
- Use `just test` for server or app behavior changes.
- Run `just ready` last for code changes.

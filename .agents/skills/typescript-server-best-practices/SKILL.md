---
name: typescript-server-best-practices
description: Reusable guidance for TypeScript server work. Use when changing API routes, request or response schemas, middleware, services, repositories, auth flows, structured logging, data-validation boundaries, or server integration tests.
---

# TypeScript Server Best Practices

## Overview

Apply this skill to keep server changes aligned with layered API design, runtime validation, structured logging, and integration-focused verification. Reuse nearby patterns before inventing a parallel server shape.

## Start Here

- Read the nearest feature or route module before editing.
- Keep changes scoped to the existing feature slice when the repository already organizes the server by feature.
- Prefer repository task runners and verification commands over ad hoc command chains.
- Avoid starting the server directly unless the repository explicitly calls for it.

## Guard The Boundaries

- Validate external or unknown data at the boundary with runtime schemas.
- Avoid casts, suppression comments, and lint bypasses. Fix the type flow or validate the data instead.
- Reuse shared constants, schemas, and helpers when they already fit.
- Prefer integration tests for route, middleware, auth, and persistence behavior unless the change is truly isolated.
- Fail loudly when required dependency data is missing or unusable. Do not keep a misleading success payload alive with placeholders or undocumented nullability.
- Treat ownership checks as part of the boundary. If a resource should belong to the authenticated user, enforce that in the query or repository call instead of trusting a client-supplied ID.

## Preserve A Layered Architecture

- Keep route contracts or request definitions close to the edge.
- Keep request and response schemas explicit and reusable.
- Read validated request data from the framework's validated request surface instead of reparsing downstream.
- Type handler context so validated request data flows through without casts when the framework supports that pattern.
- Delegate business logic to services or equivalent orchestration layers.
- Keep persistence concerns in repositories or equivalent data-access layers.
- Parse or validate non-trivial response mapping before returning it.

## Define Contracts Carefully

- Document endpoints with the repository's chosen contract system when one exists, such as OpenAPI-first route definitions.
- Attach request headers, params, query, body, responses, and status codes in the contract layer when the stack supports it.
- Keep schema naming explicit and reuse fragments when the shape already exists elsewhere.
- Use `.parse(...)` for values that must be correct and `.safeParse(...)` only when a graceful branch is intentional.
- Treat response mapping as a validation boundary, especially when aggregating data from multiple sources.

## Keep Middleware And Auth Focused

- Prefer context-injected dependencies over global singletons.
- Reuse shared auth helpers once middleware guarantees the necessary auth state.
- Keep middleware responsibilities narrow.
- Enrich request logging context when route or authenticated user information becomes known.
- Keep app-owned state out of generated auth code when the repository separates those concerns.

## Protect Persistence Performance

- Use narrow selects and return only the fields the next layer needs.
- Derive repository-local input and output types from the persistence layer when the ORM or query builder supports it.
- Check write results explicitly and raise clear domain failures when required rows are missing.
- Collect rows first for bulk writes and perform one set-based insert or update when the behavior is the same.
- Avoid N+1 reads in bulk flows. Fetch related records in sets and resolve from an in-memory map.
- Resolve ownership-sensitive parent records before looking up child resources by client-supplied identifiers alone.
- When querying user-scoped resources, join or filter on the authenticated user's ownership boundary in the same query path so another user's resource ID cannot leak data or authorize mutation.

## Log Structurally

- Use the shared logger rather than `console.*` in server code when the repository has a structured logging path.
- Emit flat structured fields.
- Include meaningful event names and standard request or business fields when relevant.
- Avoid secrets, tokens, cookies, raw request bodies, or sensitive payload dumps in logs.
- Add or update tests when logging behavior changes.

## Test And Verify End To End

- Load [testing-best-practices](../testing-best-practices/SKILL.md) for broader test workflow decisions.
- Reuse existing test fixtures, app-construction helpers, auth helpers, and request helpers.
- Assert status, response shape, side effects, persisted state, and authorization behavior when the change crosses those boundaries.
- Add regression coverage for cross-user access attempts whenever you touch ownership-sensitive queries, handlers, or repositories.
- Parse response bodies with the same schemas used by production code when that keeps tests honest.
- Run the narrowest useful compile, lint, typecheck, or test commands while iterating, then run the repository's required final verification.

## Expected Output When Using This Skill

Finish by stating:

- which server layers or patterns you followed
- which routes, services, repositories, or middleware you touched
- which verification commands ran
- whether the repository's final verification passed, or why it was skipped

---
name: endpoint-integration-tests
description: Write or refactor integration tests for a server endpoint. Use when a user asks to implement endpoint integration tests that should exercise the real application boundary, use the repository's real database test harness with no mocking, avoid duplicated assertions or setup helpers, and describe endpoint behavior clearly through test names and assertions.
---

# Endpoint Integration Tests

Write endpoint integration tests through the real request path and real persistence layer.

## Discover The Harness First

- Find the repository's existing integration test fixture before writing anything.
- Search for the app-construction helper, integration test base fixture, database setup utility, and existing `*.integration.test.*` files.
- Reuse the existing harness even if it is imperfect. Extend it only when the endpoint cannot be tested cleanly with the current helper surface.
- Do not start the server process if the repository already exposes an in-memory request surface.

## Default Operating Rules

- Use the real database. Do not mock repositories, ORM calls, auth providers, or request handlers.
- Use environment variables only if the existing integration harness already depends on them.
- Dogfood real endpoints for setup where practical.
  If an endpoint requires a prerequisite resource, create that resource through the corresponding real endpoint unless there is a concrete reason not to.
- Keep test setup deterministic and minimal. Create only the records needed for the behavior under test.

## Write Behavior-First Tests

- Name tests for the observable endpoint behavior, not the implementation detail.
- Put the suite next to the feature under test and follow the repository's local test filename pattern.
- Assert the contract that matters for the endpoint:
  status, response body, important headers, persisted state, and logs when logging is part of the endpoint behavior.
- Prefer one clear behavior per test.

Examples of good test names:

- `creates a persisted session and returns auth headers`
- `rejects a duplicate email without creating a second account`
- `returns validation issues for an invalid callback URL`
- `does not return another user's resource`

Examples of weak test names:

- `test sign in`
- `works`
- `calls repository correctly`

## Avoid Duplication Aggressively

- Reuse existing helpers for request building, success parsing, validation assertions, and seeded data creation.
- When you notice the same response parsing or validation assertions in more than one suite, extract a shared helper immediately instead of copying one more block.
- Prefer parameterized shared helpers over endpoint-specific clones.

Examples:

- Good:
  `expectEndpointSuccess(response, STATUS_CODES.CREATED)`
- Good:
  `expectValidationIssueForField(response, "email")`
- Bad:
  `expectSuccessfulSignUpResponse`, `expectSuccessfulSignInResponse`, and `expectSuccessfulRefreshResponse` that differ only by status code and route name

## Cover The Endpoint Completely

Start with the happy path, then add the failure and validation paths that define the contract.

For most endpoints, cover:

- success with persisted side effects
- validation failures for malformed or incomplete input
- domain failures such as duplicates, missing prerequisites, or forbidden access
- auth or ownership behavior when the endpoint is user-scoped
- header behavior when the endpoint emits tokens, cookies, pagination, or caching information

Do not assume every `400` has the same shape. Assert the actual contract returned by the framework and middleware stack.

## Work Pattern

1. Read the route, handler, request schema, response schema, and nearby integration tests.
2. Identify which existing fixture and helper utilities already cover app setup, database setup, request IDs, log capture, or seeded records.
3. Add the narrowest useful integration test file or extend the nearest existing suite.
4. Extract shared test helpers only when repetition is real and the shared helper keeps intent clearer than the duplicated code.
5. Run the smallest useful test target first.
6. Run the repository's broader server verification.
7. Run the repository's final required verification command last.

## Example Shape

Example request helper:

```ts
async function sendCreateWidgetRequest(app: AppRequestClient, payload: unknown, headers?: Headers) {
  return app.request(CREATE_WIDGET_ROUTE_PATH, {
    method: 'POST',
    headers: headers ?? new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
}
```

Example success assertion:

```ts
const { body, headers } = await expectEndpointSuccess(response, STATUS_CODES.CREATED);
expect(body.id).toBeTruthy();
expect(headers['set-auth-token']).toBeTruthy();
```

Example persistence assertion:

```ts
const createdWidget = await db.query.widget.findFirst({
  where: { id: body.id },
});
expect(createdWidget).toMatchObject({
  ownerId: userId,
  name: payload.name,
});
```

Example validation assertion:

```ts
const response = await sendCreateWidgetRequest(app, { name: '' });
await expectValidationIssueForField(response, 'name');
```

## Verification

- Run the narrowest useful endpoint test target first.
- Then run the repository's broader server or backend verification command.
- Run the repository's final required verification command last.

## Expected Output

State:

- what endpoint behavior is now covered
- which existing helpers were reused
- which new shared helpers were introduced, if any
- which verification commands ran
- whether the repository's final verification passed

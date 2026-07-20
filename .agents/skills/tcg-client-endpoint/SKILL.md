---
name: tcg-client-endpoint
description: Implement or extend a TCG Swift client endpoint from the server contract and generated OpenAPI client. Use when adding a TCGClient API method for an endpoint in `server/`, including its public payload/error types, credential or persistence side effects, and focused Swift transport-boundary tests.
---

# TCG Client Endpoint

Implement TCGClient endpoint support from the server contract through the generated Swift client. Preserve existing client conventions and test the observable request, response mapping, and persistent effects.

## Discover The Contract

1. Run `just` from the repository root to identify the current command surface.
2. Read the target path and operation in `app/Modules/TCGClient/Sources/TCGClient/openapi.yaml`.
3. Read the corresponding server route, handler, payload/response schemas, and integration tests under `server/src/`. Treat the server behavior and committed OpenAPI specification as the contract; do not change either unless the user explicitly requests a server-contract change.
4. Inspect the nearest endpoint in `TCGAuthClient.swift`, its payload and error types, and its Swift tests. Reuse shared business logic at the lowest suitable layer instead of copying it.
5. Build the affected Swift package if necessary to inspect the generated operation and response-case names. Generated sources live under the package `.build` directory and must not be edited.

## Implement The Client API

- Add a narrow public payload type only for request fields the client exposes. Make it `Codable` and `Equatable` so production serialization is directly testable.
- Add a dedicated public error type when the endpoint has an independent failure domain. Match nearby client error conventions and map each documented response case deliberately.
- Extend the relevant public client protocol and implementation using the generated `Client` operation. Do not hand-build HTTP requests or duplicate generated API models.
- Parse validation responses with the existing `TCGClientValidationErrorParser`.
- Preserve required side effects—such as credential storage—using the existing shared helper. Translate transport failures, malformed required response data, storage failures, and undocumented responses into the endpoint's explicit unknown-failure case.
- For a documented status whose user-facing mapping is not established by a sibling endpoint, ask the user before choosing a new public error behavior.

## Test At The Generated-Client Boundary

- Apply `swift-best-practices`, `swift-testing`, and `software-testing` when modifying Swift and tests. Apply `typescript-backend` only if the requested work also changes `server/`.
- Use Swift Testing and the existing test suite. Inject an `OpenAPIRuntime.ClientTransport` actor that records the request; do not mock the generated `Client`.
- Decode the captured request body using the production payload type and assert method, path, operation ID, and serialized payload.
- Test success with the real generated response parsing and assert each observable side effect, such as stored credentials.
- Add separate tests for each meaningful documented failure mapping, including validation and authentication failures when applicable. Use `Result.get()` and `#require(throws:)` for result assertions.

## Verify

1. Run `swift test` from `app/Modules/TCGClient` while iterating.
2. Run `just test-app`.
3. Run `just ready` last for any code or test change.
4. Report every command run and any uncertainty or contract mismatch discovered. Do not claim completion unless `just ready` passes.

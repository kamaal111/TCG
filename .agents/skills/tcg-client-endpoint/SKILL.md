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
4. Inspect the nearest endpoint in `TCGCardsClient.swift` or `TCGPricingClient.swift`, its payload and error types, and its Swift tests. For auth work, inspect `TCGAuthRequestHooks.swift`, `AuthTokenIssuer.swift`, and the KamaalAuth integration in `TCGClient.swift`. Reuse shared business logic at the lowest suitable layer instead of copying it.
5. Build the affected Swift package if necessary to inspect the generated operation and response-case names. Generated sources live under the package `.build` directory and must not be edited.

## Implement The Client API

- Add a narrow public payload type only for request fields the client exposes. Make it `Codable` and `Equatable` so production serialization is directly testable.
- Add a dedicated public error type when the endpoint has an independent failure domain. Match nearby client error conventions and map each documented response case deliberately.
- Extend the relevant public client protocol and implementation using the generated `Client` operation. Do not hand-build HTTP requests or duplicate generated API models.
- Parse validation responses with the existing `TCGClientValidationErrorParser`.
- Preserve required side effects—such as credential storage—using the existing shared helper. Translate transport failures, malformed required response data, storage failures, and undocumented responses into the endpoint's existing typed failure mapping.
- For a documented status whose user-facing mapping is not established by a sibling endpoint, ask the user before choosing a new public error behavior.

## Test At The Generated-Client Boundary

- Apply the Kamaal Super Mind `swift-best-practices` and `software-testing` skills when modifying Swift and tests. Apply its `backend` and `typescript-best-practices` skills only if the requested work also changes `server/`.
- Use Swift Testing and the existing test suite. Inject an `OpenAPIRuntime.ClientTransport` actor that records the request; do not mock the generated `Client`.
- Decode the captured request body using the production payload type and assert method, path, operation ID, and serialized payload.
- Test success with the real generated response parsing and assert each observable side effect, such as stored credentials.
- Add separate tests for each meaningful documented failure mapping, including validation and authentication failures when applicable. Use `Result.get()` and `#require(throws:)` for result assertions.

## Verify

1. Run `just quality` from the repository root while iterating.
2. Use `just test-app-macos` for app tests during iteration; use `just test-app-ios` for iOS coverage, outside the filesystem sandbox. Never invoke iOS `xcodebuild` tests directly.
3. Run `just ready-app` last for app-only code/test changes, or `just ready` when server code also changes.
4. Report every command run and any uncertainty or contract mismatch discovered. Do not claim completion unless the matching final recipe passes.

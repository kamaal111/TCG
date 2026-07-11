---
name: swift-testing
description: Write or refactor focused Swift tests in this repository. Use when a user asks to add, update, debug, or verify tests for Swift source, Swift packages, client code, async behavior, request serialization, response parsing, or persistent side effects.
---

# Swift Testing

Write deterministic Swift tests that prove observable behavior while isolating only external boundaries.

## Discover Before Writing

- Read the source under test, its direct collaborators, package manifest, and nearest Swift tests.
- Identify the primary unit under test and name the test file and `@Suite` after it.
- Reuse the repository's `testing-best-practices` and `swift-best-practices` guidance.
- Use Swift Testing (`@Suite`, `@Test`, and backticked test names) unless the target is an existing XCTest or XCUITest target.

## Choose The Boundary

- Keep business logic, request serialization, response parsing, and error mapping real.
- Replace only the narrowest external-I/O boundary. For OpenAPI clients, use an `OpenAPIRuntime.ClientTransport` test double instead of mocking the generated client or the feature client.
- Make required persistent side effects narrow dependencies. Inject the production adapter in normal construction and an observable actor test double in tests; never use a real keychain, filesystem, or user store in a unit test.
- Use actors for test doubles that record async calls or mutable state.

## Write The Tests

- Write a separate test for each success and meaningful error behavior.
- In a request-boundary test, assert the method, path, operation ID, decoded production payload, returned result, and observable side effect relevant to that behavior.
- Decode captured JSON using the production `Codable` payload type. Add the conformance to the production type instead of creating a test-only copy.
- Use `try result.get()` for success. Use `#require(throws: ExpectedError)` for expected `Result` failures.
- Keep assertions flat. Do not hide assertions in `if`, `guard`, or `switch` branches.
- Use `#require` for required captured values and fixture setup values. Do not force unwrap.
- Format JSON fixtures across multiple indented lines.

## Example Shape

```swift
@Suite("Auth Client Tests")
struct AuthClientTests {
    @Test
    func `Should store credentials after a successful sign up request`() async throws {
        let credentialsStore = CredentialsStoreSpy()
        let transport = try SignUpTransport.success()
        let client = makeClient(transport: transport, credentialsStore: credentialsStore)

        try await client.signUp(payload).get()

        let request = try #require(await transport.recordedRequest)
        #expect(request.method == .post)
        let storedCredentials = try #require(await credentialsStore.storedCredentials)
        #expect(storedCredentials.key == "credentials-key")
    }
}
```

## Verification

1. Run the narrow package suite while iterating: `swift test` from the affected package directory.
2. Run `just test-app` for app and Swift package changes.
3. Run `just ready` last for any code or test change.
4. If a repository-wide command fails outside the affected test target, report the exact failing command and cause; do not describe the work as fully verified.

## Expected Output

State the behavior covered, the dependency boundary replaced, the test double's observed effect, every verification command run, and whether `just ready` passed.

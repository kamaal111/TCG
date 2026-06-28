# Swift Testing Best Practices

## Test Naming

Always use backtick function names for tests. The function name is the display name — do not pass a separate string to `@Test`.

```swift
@Test
func `Should add session token to Authorization header for token refresh endpoint`() async throws {
    // ...
}
```

Do **not** use `@Test("description")` with a camelCase function name. Only the backtick style is used in this codebase.

## Grouping with `@Suite`

Use `@Suite("Display Name")` to group related tests under a named suite. Keep the annotation even when the struct name is descriptive — it controls the display name shown in test output.

```swift
@Suite("RefreshTokenMiddleware Tests")
struct RefreshTokenMiddlewareTests {

    @Test
    func `Should add session token to Authorization header for token refresh endpoint`() async throws {
        // ...
    }
}
```

## SwiftLint Enforcement

The `swift_testing_no_labeled_test` custom rule in `app/.swiftlint.yml` errors on `@Test("...")` across all source and test files. Using a string label with `@Test` will fail `just lint-app`.

## Verification

Run tests with:

```sh
just test-app   # Swift app tests only
```

## Asserting `Result` Failures

When a Swift API under test returns `Result`, prefer asserting through `.get()` rather than switching over `.success` and `.failure` manually.

For failure expectations, use `#require(throws:)` around `.get()` so the test proves the exact thrown error and fails naturally if the call unexpectedly succeeds.

```swift
try await #require(throws: MyFeatureError.badRequest(validations: [
    ValidationIssue(path: ["email"], message: "Invalid email address"),
])) {
    try await client.submit(...).get()
}
```

Avoid patterns like:

```swift
let result = await client.submit(...)
switch result {
case let .failure(error):
    #expect(error == expectedError)
case .success:
    Issue.record("Expected submission to fail")
}
```

That style duplicates Swift Testing's built-in failure behavior and makes tests noisier. If the code should succeed, call `.get()` directly in an `async throws` test instead of checking `if case .failure`.

---

## XCUITest (UI Testing)

XCUITest uses `XCTestCase` (not Swift Testing's `@Test`/`@Suite`) and lives in a separate Xcode target, not a Swift package. The target's `productType` must be `"com.apple.product-type.bundle.ui-testing"` and it needs a `PBXTargetDependency` on the app target.

### Preventing real network calls

Never let the app make real API calls during UI tests. Use a launch environment variable (e.g. `IS_UI_TESTING=1`) to switch the app into mock mode before `app.launch()`. The app reads this at startup and substitutes preview/stub clients for real ones. Use additional env vars to trigger specific failure modes (e.g. `IS_UI_TESTING_FAIL_<ACTION>=1`) so you can test error paths without a real server.

### Test class structure

Mark the class `@MainActor` to avoid Swift 6 concurrency warnings — all XCUITest APIs are main-actor-isolated. Avoid overriding `setUpWithError()` / `tearDownWithError()` — they are `nonisolated` and produce concurrency warnings on an `@MainActor` class. Instead, use a private helper that launches and returns the app:

```swift
@MainActor
final class MyFeatureUITests: XCTestCase {
    private func launchApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["IS_UI_TESTING"] = "1"
        app.launch()
        return app
    }
}
```

Do not add `throws` to test functions that don't actually throw — SwiftFormat flags it as `redundantThrows`.

### Finding elements

Prefer **accessibility labels** over accessibility identifiers — labels are read aloud by VoiceOver so they improve the app for real users, whereas identifiers are invisible automation hooks with no user benefit. Add `.accessibilityLabel(Text("..."))` to interactive elements that have no visible text (e.g. icon-only buttons), and find them in tests with `app.buttons["label text"]`.

For elements that already have visible text (e.g. a `Button` containing `Text("Add Transaction")`), the visible text is already their accessibility label — no annotation needed, and `app.buttons["Add Transaction"]` works directly.

On macOS, `TextField` uses its `title` argument as a visible placeholder, so fields are often findable by their label text without extra annotations.

Toasts and banners rendered as `Text` views are findable as `app.staticTexts["message text"]`.

### Timing

Always use `waitForExistence(timeout:)` rather than accessing elements immediately — the UI is asynchronous. Use longer timeouts for interactions that involve debounce, animation, or async work, and shorter ones for asserting elements that should already be present.

### Asserting navigation

Prefer asserting element presence/absence over `navigationBars[title]` — nav bar titles behave differently across platforms. After navigating forward, wait for an element unique to the destination. After navigating back, wait for an element that only appears on the source screen and assert the destination element no longer exists.

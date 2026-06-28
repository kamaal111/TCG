---
name: swift-best-practices
description: Reusable guidance for Swift code in this repository. Use when writing, editing, or refactoring Swift source files so generated code matches the team's preferred style and control-flow patterns.
---

# Swift Best Practices

Apply this skill to keep Swift code aligned with the team's local style. Start small, match nearby code, and prefer the established repository patterns over generic Swift defaults.

## Guard Statements

- Prefer single-condition `guard` statements instead of combining multiple conditions in one `guard`.
- Split independent checks into separate `guard` blocks so each exit point is easier to read, debug, and breakpoint individually.
- Keep the `guard` header on one line when the full condition fits within the repository's configured line width.
- Keep the failure path close to the condition being checked.

Prefer:

```swift
guard let session = session else {
    return .missingSession
}

guard session.isActive else {
    return .inactiveSession
}
```

If a single condition becomes long enough to exceed the configured line width, wrap only that condition while still keeping it as its own `guard`:

```swift
guard let pokemon = pokedex
    .entry(for: speciesIdentifier)
else {
    return nil
}
```

Avoid combining separate checks into one `guard`:

```swift
guard let session = session, session.isActive else {
    return .invalidSession
}
```

## Invariants And Optionals

- When a value should always exist for the app to function correctly, fail fast instead of hiding the problem behind `??`, permissive `guard` fallbacks, or other silent recovery.
- Prefer `assertionFailure`, `preconditionFailure`, `fatalError`, or force unwrapping at the point where an impossible `nil` or invalid state first becomes visible, so the app surfaces configuration and wiring bugs immediately during development.
- Use optional handling and default values only when they genuinely improve the user experience and represent a real, intentional recovery path.
- Do not add placeholder defaults just to keep execution moving when doing so would leave the app in an unknown or misleading state.

Prefer:

```swift
let apiBaseURL = configuration.apiBaseURL!
```

Or:

```swift
guard let modelContext else {
    preconditionFailure("Model context must be configured before launching the app.")
}
```

Avoid:

```swift
let apiBaseURL = configuration.apiBaseURL ?? URL(string: "https://example.com")!
```

```swift
guard let modelContext else {
    return
}
```

## Pure Utilities

- Do not turn pure utilities into injected dependencies just to satisfy an abstract architecture pattern.
- Prefer stateless utility APIs as namespace-style types with `static` functions or similarly simple call sites when they have no meaningful lifecycle or replaceable behavior.
- Avoid adding stored properties and initializer parameters for pure utility collaborators when the code can call the utility directly.
- Do not mock or replace pure utility implementations in tests. Test the real utility behavior so edge cases are exercised instead of hidden behind a fake.
- Reserve dependency injection for components with side effects, external I/O, environment access, mutable state, or behavior that genuinely varies by implementation.

## Shared Ownership

- Do not copy non-trivial Swift logic into a second module just to make it reachable from a new caller.
- Prefer moving reusable behavior into the lowest suitable shared target, such as a service, model, utility, or package layer that both callers can depend on.
- When moving code across targets, remove the original implementation in the same change unless it still has intentionally different behavior.
- If similar code remains in two places, make the ownership boundary and behavioral difference explicit through names, tests, or module responsibilities.
- Before adding a new helper, search for existing helpers with the same responsibility and extend or relocate them when that keeps one source of truth.

## Non-Private Error APIs

- If a method is not `private` and it can fail, prefer returning `Result<Success, Failure>` instead of exposing a throwing API.
- Use one specific custom `Failure` type for that API instead of `Error`.
- Make the custom error ready for user-facing presentation by providing a localized `errorDescription`.
- Keep the error domain narrow and explicit so callers can switch over concrete failure cases without guessing.
- Use `throws` freely for private helpers when that keeps implementation code simpler, but translate those failures into the public custom error before crossing a non-private boundary.

Prefer:

```swift
enum PokemonImportError: LocalizedError, Equatable {
    case missingName
    case invalidImage

    var errorDescription: String? {
        switch self {
        case .missingName:
            String(localized: "The Pokemon name could not be found.")
        case .invalidImage:
            String(localized: "The selected image could not be processed.")
        }
    }
}

func importPokemon(from image: UIImage) async -> Result<Pokemon, PokemonImportError> {
    // ...
}
```

Avoid:

```swift
func importPokemon(from image: UIImage) async throws -> Pokemon {
    // ...
}
```

## Working Style

- Match naming, formatting, and file structure that already exists near the code you are editing.
- When the same string literal appears in more than one place, prefer a shared enum, constant, or similarly central definition so stringly-typed values stay manageable and easier to maintain.
- Add new rules to this skill only after they are explicitly agreed on, so the guidance stays precise and trustworthy.

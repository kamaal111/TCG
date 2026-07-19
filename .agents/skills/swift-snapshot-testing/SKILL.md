---
name: swift-snapshot-testing
description: Add, update, record, or debug SwiftUI snapshot tests using Point-Free SnapshotTesting and Swift Testing. Use when snapshotting SwiftUI views or screens across macOS and iOS, choosing device/reference names, recording PNG baselines, configuring xcodebuild destinations, or diagnosing snapshot mismatches in this repo.
---

# Swift Snapshot Testing (TCG)

Use the Kamaal Super Mind `swift-snapshot-tests` skill (and its `software-testing` reference) for how to write, cover, and record snapshot tests. This skill only adds what is specific to this repo: where the package is wired in and how to run it through `just`.

## Wiring The Package

Follow the plugin's installation reference for the `Package.swift` dependency and test-target wiring. In this repo, that module lives under `app/Modules/<Module>/` (e.g. `TCGFeatures`, `TCGAuth`) with its own `Package.swift` — apply the wiring there, matching that module's existing `swiftSettings` (`ApproachableConcurrency`, warnings-as-errors).

## Destinations

Use the readable Xcode destination already pinned in the root `justfile` (`APP_IOS_TEST_DESTINATION`) rather than a simulator UUID:

```text
platform=iOS Simulator,OS=27.0,name=iPhone 17
```

Refresh it with `just app-destinations` when the simulator changes. If Xcode reports a selected simulator's data directory is missing, recreate that simulator before trusting a passing run on another device.

## Verify

1. `just test-snapshots-macos`
2. `just test-snapshots-ios`
3. Inspect materially changed PNGs visually.
4. `just ready`

Report the platforms and states covered, every reference added or removed, and the exact verification results.

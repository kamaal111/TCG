---
name: swift-snapshot-testing
description: Add, update, record, or debug SwiftUI snapshot tests using Point-Free SnapshotTesting and Swift Testing. Use when snapshotting SwiftUI views or screens across macOS and iOS, choosing device/reference names, recording PNG baselines, configuring xcodebuild destinations, or diagnosing snapshot mismatches.
---

# Swift Snapshot Testing

Create deterministic visual regression tests at the view boundary. Use them for fixed, representative states; leave interaction flows to UI tests and behavior to unit tests.

## Discover First

1. Read repository instructions, the package manifest, the nearest test target, and the task runner.
2. Confirm that the screen can accept deterministic state and injected external dependencies.
3. Locate the aggregate verification command. Use its focused macOS/iOS snapshot recipes while iterating.

Use Swift Testing unless the target already uses XCTest. Add `SnapshotTesting` only to the test target. Exclude `__Snapshots__` from SwiftPM source compilation when necessary.

## Write the Test

Create the screen in a realistic, stable state:

- Set model inputs explicitly.
- Inject a deterministic test transport or service. Do not use live network, Keychain, current time, or random data.
- Set a fixed color scheme when appearance is part of the reference.
- Keep one assertion per intended platform/reference.

```swift
@Suite("Profile Screen Snapshot Tests")
@MainActor
struct ProfileScreenSnapshotTests {
    @Test
    func `Renders the signed-in state`() {
        #if os(macOS)
            assertSnapshot(of: makeMacOSScreen(), as: .image)
        #elseif os(iOS)
            assertSnapshot(
                of: makeScreen(),
                as: .image(layout: .device(config: .iPhone13)),
                named: "iPhone"
            )
        #endif
    }
}
```

Name the reference for its product role, not the implementation detail. For example, use `iPhone`, not `iPhone13`, when `.iPhone13` is only the rendering configuration. Add iPad references only when that layout is intentionally supported and reviewed.

## macOS Canvas

Snapshot an `NSHostingView` on macOS and give it an explicit desktop-shaped frame. Do not reuse a phone-sized canvas.

```swift
private func makeMacOSScreen() -> NSHostingView<some View> {
    let view = NSHostingView(rootView: makeScreen())
    view.appearance = NSAppearance(named: .aqua)
    view.frame = NSRect(x: 0, y: 0, width: 1_280, height: 960)
    view.wantsLayer = true
    view.layer?.backgroundColor = NSColor.white.cgColor
    return view
}
```

Choose dimensions that reveal the desktop layout, then inspect the recorded PNG. A snapshot that is merely a taller phone canvas is not useful macOS coverage.

## Record Baselines Deliberately

Run the focused test once to observe a missing or changed reference. Record only after visually reviewing the intended state.

Use SnapshotTesting's explicit recording mode temporarily when the test runner does not pass `SNAPSHOT_TESTING_RECORD` through to the test process:

```swift
assertSnapshot(of: value, as: .image, record: .all)
```

Recording intentionally reports an issue after writing the image. Remove `record: .all` immediately, then rerun the same focused test normally to prove the committed reference matches. Never leave recording mode in source.

Keep only active baselines in `__Snapshots__/`. Delete renamed or removed device references, including stale staged files, so later commits cannot retain obsolete coverage.

## Destinations

Use a readable Xcode destination rather than a simulator UUID in repository configuration:

```text
platform=iOS Simulator,OS=27.0,name=iPhone 17
```

Find the current value with the repository's destination-listing recipe. A UUID is tied to one simulator installation and will break after recreation. Include the OS when names might occur across runtimes.

If Xcode reports that a selected simulator data directory is missing, recreate that broken simulator before trusting a passing run on another device.

## Verify

1. Run the focused macOS snapshot command.
2. Run the focused iOS snapshot command.
3. Inspect materially changed PNGs visually.
4. Run the repository aggregate verification command.

Report the platforms and states covered, every reference added or removed, and the exact verification results. Do not claim success from a run that used an environment override when the default recipe has not passed.

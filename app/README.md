# TCG app

[Back to README](../README.md)

The native app uses SwiftUI, Observation, and local Swift packages. The app target
currently declares iOS 18.6 and macOS 27 minimums, while the reusable packages declare iOS 18 and
macOS 15 minimums. All packages use Swift tools version 6.4. Use an Xcode toolchain
that supports that version and the configured app SDKs.

## Run the app

Start the local API with `just dev-server` from the repository root, then:

```sh
just xcode
```

Select the `TCG` scheme and a supported macOS or iOS simulator destination in
Xcode. Resolve package dependencies and trust the Swift OpenAPI build plugin
when prompted. Run the app and create an account or sign in.

The app provides Collection and Search tabs. Collection supports a game filter,
add/edit forms, condition quantities, notes, deletion, and pricing rows. Search
debounces name/number queries of at least two characters within a selected game.
Search history is saved on the device separately for each game. The empty search
shows five recent queries and a full-history link; typing offers matching previous
queries. Reusing a query fetches current prices. Only completed searches that found
cards are saved, with automatic searches recorded at the end of editing. Users can
remove individual entries or clear the selected game's history.

Settings contains sign-out confirmation and app version information; it is an
iOS tab and a separate macOS Settings scene. The macOS Settings command appears
only while signed in.

## Packages and state

| Package / target | Responsibility |
| --- | --- |
| `TCGApp` | `TCGScene`, navigation, shared feature objects, and KamaalAuth injection |
| `TCGFeatures` / `TCGCards` | Collection state, validation, card forms, and collection screens |
| `TCGFeatures` / `TCGSearch` | Search state, scheduling, and priced-card rows |
| `TCGFeatures` / `TCGSettings` | Sign out and version display |
| `TCGFeatures` / `TCGSnapshotTesting` | Shared screen snapshot assertions for tests |
| `TCGClient` | Auth integration, typed collection/pricing clients, models, payloads, errors, and preview clients |
| `TCGDesignSystem` | Shared controls, toasts, and card image loading/rendering |
| `TCGModels` | Localized game model bridging app and client enums |
| `TCGUtils` | Keychain and expiring-value utilities |

Observable feature objects own data and operations; screen models own UI state
such as form presentation, filters, toast lifetimes, and search tasks. Feature
environment modifiers supply the objects to screens. KamaalAuth owns the auth
UI/state and credential lifecycle. Production credentials use a Keychain-backed
store; preview clients use in-memory state and do not touch the network or Keychain.

Card images use a shared loader with URLSession HTTP caching, a bounded decoded
image cache, in-flight request sharing, and concurrent load limits. It retries
timeouts and HTTP 429/503 responses. Preview image dependencies keep snapshot
rendering independent of network timing.

## API contract and server URL

The client contract is
[openapi.yaml](Modules/TCGClient/Sources/TCGClient/openapi.yaml), with generator
configuration next to it. The OpenAPI build plugin generates client/types at
build time; handwritten adapters expose `TCGClient.auth`, `.cards`, and `.pricing`.

`TCGClient.default()` resolves its URL with the generated `Servers.Server1.url()`.
The committed YAML uses `http://localhost:8080`. There is no runtime URL setting
in the app, and changing the root `.env` does not change an already built client.

For endpoint changes, edit the server routes and schemas, then run from the root:

```sh
just download-spec
just check-spec
```

Rebuild in Xcode to regenerate Swift types, extend the corresponding client
adapter, and add focused client transport tests. The repository-local
[TCG client endpoint skill](../.agents/skills/tcg-client-endpoint/SKILL.md)
describes the full endpoint workflow. Auth response header conformances are kept
in `AuthTokenHeaders+Generated.swift` and must stay aligned with the generated
operations when authentication responses change.

For a temporary non-default development host, edit the YAML's `servers` URL
locally and rebuild. This local override will fail `just check-spec`; restore it
before committing. `just download-spec` always writes the canonical localhost
URL. A physical iPhone needs a reachable address for the Mac/server, and
`BETTER_AUTH_URL` and `PUBLIC_BASE_URL` must also be reachable for auth and image
links. Local HTTP/network access must satisfy the device's app networking policy.

The client uses a session-token middleware for `/auth/token` and an authorization
middleware for normal JWT requests. `AuthTokenIssuer` and `TCGAuthRequestHooks`
bridge the generated operations to KamaalAuth. See the
[API authentication guide](../server/docs/api.md#authentication) for the headers.

## Previews and tests

Use the existing preview clients and feature preview factories for stable screen
data and controlled error states. Tests cover auth/client transport mapping,
feature operations, form validation, settings version formatting, utilities,
image loading, and screen/image snapshots. The Xcode scheme uses `TCG.xctestplan`.

Run from the repository root:

```sh
just quality-app
just test-app-macos
just test-app-ios
just test-snapshots-macos
just test-snapshots-ios
just ready-app          # required final aggregate for app-only code changes
```

Use the iOS recipes rather than invoking simulator tests directly; the wrapper
serializes shared simulator access. Automation agents must run them outside a
filesystem sandbox. Inspect destinations with `just app-destinations` and set
`TCG_APP_IOS_TEST_DESTINATION` when the local default is unavailable. CI uses
`iPhone 17` on iOS 27.0 and the `xcode-27` runner.

GitHub Actions skips the local simulator lock. Its iOS snapshot step uses
`scripts/run-ios-snapshots-ci.ts` to supervise the recipe in a separate process
group. Cancellation allows two seconds for a graceful stop before killing
remaining build and test processes; termination or repeated cancellation
escalates immediately. Simulator shutdown has a separate two-second deadline
on success, failure, and cancellation. These limits apply only to CI's isolated
runner. Cancelled runs skip snapshot artifact collection; ordinary failures
still upload results. Cleanup timestamps help distinguish test cleanup delays
from an unresponsive hosted runner or a stalled action post step.

CI also fails with exit code 124 after three minutes without build or test
output, stopping the process group and running the same bounded cleanup.
Each stdout or stderr chunk resets this deadline. Set
`TCG_IOS_SNAPSHOT_IDLE_TIMEOUT_SECONDS` to a positive integer to tune it.
Verbose Xcode failure diagnostics are disabled in CI to avoid lengthy
simulator diagnostic collection; snapshot images and result bundles remain
available for ordinary test failures. Local test recipes are unchanged.

CI sets `TCG_IOS_SNAPSHOT_SIMULATOR` to the same device as its test destination
and builds snapshot test products before starting the simulator. It then waits
for `simctl bootstatus -b` and runs `test-without-building`. Boot has a fixed deadline
equal to `TCG_IOS_SNAPSHOT_IDLE_TIMEOUT_SECONDS`, even if it keeps reporting
progress. Boot failure skips tests and still shuts down the simulator.
CI builds only the destination's active architecture with at most two build
operations and disables parallel test runners, avoiding simulator clones.

Snapshots live under each suite's `__Snapshots__` directory. Review both actual
and reference images before recording new baselines. See
[snapshot failure handling](../docs/development.md#snapshot-failures) and the
[repository snapshot skill](../.agents/skills/swift-snapshot-testing/SKILL.md).

## Localization coverage

### Search help Markdown

Edit the search help documents in
`Modules/TCGFeatures/Sources/TCGSearch/Resources/en.lproj/`. The Pokémon and
One Piece documents are the source of the help layout: use Markdown headings,
paragraphs, lists, and fenced code blocks for selectable search examples.
They render locally on both macOS and iOS without fetching content.

To translate a document, add a file with the same name under
`Resources/<language>.lproj/`. Bundle localization selects the translated
document and falls back to English when it is unavailable. Markdown document
content is localized through these resources rather than the string catalog;
the help title, dismissal button, and error message remain in the catalog.

### String catalogs

CI runs `just check-localizations macos` after the macOS tests and
`just check-localizations ios` after the iOS snapshots. `just ready-app` runs both
checks too. The checks compare the Swift compiler's `.stringsdata` output with
the committed catalogs in each source module. A missing catalog, missing key, or
missing compiler extraction fails the check with the affected path. When a
non-source language appears in an app catalog, every extracted translatable key
must have a completed translation in that language, including plural variants.
English source keys can use their normal catalog fallback values.

Use localized SwiftUI APIs or `String(localized:)` for user-facing text. Select
the package's `.module` bundle when looking up its catalog. Keep game-dependent
text as explicit `LocalizedStringKey` values so the compiler extracts both
branches; use `Text(verbatim:)` for literal search examples. The check covers
compiler-extracted localization keys: it cannot infer whether an arbitrary
runtime `String` should have been localized or verify the selected bundle.

Manage catalogs through Xcode's String Catalog editor or `xcrun xcstringstool
sync`, using the target's compiler-generated `.stringsdata` files from both
macOS and iOS. Create a catalog in a new module before syncing its strings.
Run the matching platform tests before a standalone coverage check so extraction
reflects the current source. CI checks both platforms to cover conditional text
such as iOS sheet buttons. Checker regression tests run with
`just test-localization-check` and need Node.js (using the repository's `.node-version`) and installed
pnpm dependencies. They use Vitest and also run in the Linux devcontainer without Xcode.

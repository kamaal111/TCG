# TCG app

[Back to README](../README.md)

The native app uses SwiftUI, Observation, and local Swift packages. The app target
currently declares iOS 18.6 and macOS 27 minimums, while the reusable packages declare iOS 18 and
macOS 15 minimums. All packages use Swift tools version 6.4. Use an Xcode toolchain
that supports that version and the configured app SDKs.

## Swift spacing

Run `just lint-app` to check spacing around Swift initializers and methods. Each
must be separated from adjacent members by a blank line, including one-line
declarations. Consecutive properties may remain grouped. Keep documentation
comments and attributes attached to their declaration, with the blank line before
that block. Correct missing spacing manually; `just format-app` does not insert it.

Multiline call chains also require each chained call on its own line, including
SwiftUI modifiers following a button's trailing closures. For example, put
`.disabled(...)` and `.accessibilityLabel(...)` on separate lines. Entirely
single-line expressions such as `Text("Page").tag(index)` may remain compact.

SwiftUI `var body: some View` implementations must not contain standalone local
`let` or `var` declarations, including inside nested builder closures. Use computed
properties for values derived from view state, or helpers for calculations that
depend on geometry or closure arguments. Conditional bindings such as `if let`
remain allowed.

The syntax check runs automatically through `just lint`, `just format-check-app`,
`just quality`, and app CI. Run `just test-swift-member-spacing` for its regression
tests; these also run through `just ready-app`.

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

Settings contains card CSV import/export, sign-out confirmation, and app version information; it is an
iOS tab and a separate macOS Settings scene. The macOS Settings command appears
only while signed in.

## Card CSV backups

In Settings, choose **Export Cards** to save the complete collection, including all
games and sets regardless of Collection filters. Export does not fetch market
prices or backfill purchase costs. It works independently of pricing providers.

Choose **Import Cards**, then **Download CSV Template** to save a headers-only
UTF-8 CSV before entering your cards, or **Choose File…** to open a previous
export. Every file opens a review before anything is saved. Edit card details and
purchases, correct readable invalid rows, or remove cards. The review shows the
source row, column, value, and suggested correction for each issue. Invalid rows
are excluded until corrected; you can import the remaining valid purchases.
Broken CSV structure or missing columns requires fixing and choosing the file
again. Errors during submission retain the review for a safe retry.

Each row represents a purchase batch. Repeat the card metadata and use the same
`id` for all purchases belonging to one card. Separate card IDs remain separate
entries, even when the card names and numbers match.

| Columns | Accepted values |
| --- | --- |
| `id` | UUID; required and shared by the card’s purchase rows |
| `game` | `one_piece` or `pokemon` |
| `name`, `set_name`, `card_number` | Required; maximum 200, 200, and 50 characters |
| `notes` | Optional; maximum 2000 characters |
| `created_at`, `updated_at` | ISO 8601 timestamps; blank uses import time |
| `purchase_id` | UUID identifying a purchase row; blank generates one |
| `condition` | `mint`, `near_mint`, `excellent`, `good`, `played`, or `damaged` |
| `quantity` | Whole number from 1 to 999; total per condition cannot exceed 999 |
| `purchase_price`, `currency` | Both blank, or a nonnegative decimal with up to six decimal places and a supported ECB currency code, such as `EUR`, `USD`, or `JPY` |
| `automatic_price_date` | Optional real date in `YYYY-MM-DD` format, requiring a purchase price |

Keep every template column. Use commas as separators and double quotes around
values containing commas, quotes, or line breaks. Double any quote inside a
quoted value. Blank lines are ignored. A headers-only file contains no cards.

Import adds new cards and replaces changed cards whose IDs belong to your
account, including their complete purchase history. Purchases absent from the
CSV are removed from those cards; unchanged cards are skipped. CSV timestamps
are restored even when the backup is older than the current card. Cards absent
from the CSV remain in your collection. You can transfer a backup to another
account: each receiving account gets its own internal card and purchase IDs,
while the source card ID is retained for repeat-import matching and later
exports. Importing never changes another account’s cards. Purchase costs,
timestamps, notes, and automatic-pricing provenance are preserved; market
prices, images, and provider links are not part of the backup.

The completion report distinguishes new, updated, and unchanged cards, excluded
purchase rows, and cards removed during review. If saving succeeds but refreshing
fails, retry the collection refresh without importing again.

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

App test and snapshot recipes require [xcbeautify](https://github.com/cpisciotta/xcbeautify).
Run `just bootstrap` (or `just install-xcbeautify`) with Homebrew available.
The separate installer preserves an existing xcbeautify installation; otherwise
it runs `brew install xcbeautify`. Ruby and RubyGems are not required.

Both local and CI logs display formatted build tasks and named test results.
CI uses the GitHub Actions renderer; local commands use the terminal renderer.
The root Vitest suite checks both renderers against representative build,
Swift Testing, and XCTest output when xcbeautify is installed. It runs in app CI
and `just ready-app`. If an older installation fails this compatibility
check, run `brew upgrade xcbeautify`. The check is validated with xcbeautify 3.2.1.
Newer Swift Testing aggregate lines containing “in 3 suites” are not parsed by
that version; the iOS job summary still reports totals from the raw stream.

Recipes display formatted output and retain raw stdout/stderr under
`.build/xcode-logs/`, replacing the log for that recipe on its next run. Set
`TCG_XCODE_LOG_DIR` to choose another directory, or use
`TCG_XCODE_RAW_OUTPUT=1 just test-app-macos` to troubleshoot with raw output.
CI uploads `macos-xcode-logs` and `ios-xcode-logs` artifacts on failure for seven
days. The iOS supervisor inspects raw output before the outer runner formats it,
preserving its watchdogs and completed-test checks.

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

CI allows up to ten minutes from launching the test phase until the first test
starts. This is a fixed startup deadline: output cannot extend it. Set
`TCG_IOS_SNAPSHOT_STARTUP_TIMEOUT_SECONDS` to a positive integer to tune it.
After tests begin, or while building, three minutes without output fails with
exit code 124 and the same bounded cleanup. Each stdout or stderr chunk resets
this inactivity deadline. Set `TCG_IOS_SNAPSHOT_IDLE_TIMEOUT_SECONDS` to a
positive integer to tune it. Startup duration and the timeout phase appear in
the CI summary. An exit-zero test process must report at least one completed
test; empty runs fail instead of passing the snapshot check.
Verbose Xcode failure diagnostics are disabled in CI to avoid lengthy
simulator diagnostic collection; snapshot images and result bundles remain
available for ordinary test failures. Local test recipes are unchanged.

CI sets `TCG_IOS_SNAPSHOT_SIMULATOR` to the same device as its test destination
and builds snapshot test products before starting the simulator. It then waits
for `simctl bootstatus -b` and runs `test-without-building` directly from the
generated `.xctestrun` manifest, avoiding a second project/package resolution.
Each staged CI run builds into a fresh temporary DerivedData directory and
requires exactly one TCG iOS Simulator manifest before booting. The supervisor
passes its absolute path through `TCG_APP_IOS_XCTESTRUN`; without that variable,
`just test-built-snapshots-ios` retains its scheme-based behavior.
Boot has a fixed deadline equal to `TCG_IOS_SNAPSHOT_IDLE_TIMEOUT_SECONDS`, even if it keeps reporting
progress. Boot failure skips tests and still shuts down the simulator.
CI builds only the destination's active architecture with at most two build
operations and disables parallel test runners, avoiding simulator clones.

Snapshots live under each suite's `__Snapshots__` directory. Review both actual
and reference images before recording new baselines. See
[snapshot failure handling](../docs/development.md#snapshot-failures) and the
[repository snapshot skill](../.agents/skills/swift-snapshot-testing/SKILL.md).

Filter model tests cover exact selection and persistence behavior; screen
snapshots retain representative selected-filter layouts in light and dark.
The collection game/set and search set accessibility-size snapshots run on iOS
only: their macOS references were identical to the standard-text snapshots.

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

CI runs `just check-localizations-macos` after the macOS tests and
`just check-localizations-ios` after the iOS snapshots. `just ready-app` runs both
checks too. The checks compare the Swift compiler's `.stringsdata` output with
the committed catalogs in each source module. A missing catalog, missing key, or
missing compiler extraction fails the check with the affected path. When a
non-source language appears in an app catalog, every extracted translatable key
must have a completed translation in that language, including plural variants.
English source keys can use their normal catalog fallback values.

When the build uses an explicit `OBJROOT`, pass it to the checker to avoid another
Xcode build-settings query:

```sh
just check-localizations-ios --build-root /tmp/tcg-ios-intermediates --configuration Debug-iphonesimulator
```

Both options are required together and must describe the current build's compiler
output. The default invocation continues to discover those settings through Xcode.
CI supplies its iOS intermediate directory directly and reports localization time
alongside snapshot duration, Swift dependency cache status, time to first test,
and completed test count in the job summary. Swift package downloads are cached
separately from build products and simulator state.

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
`just test-scripts` and need Node.js (using the repository's `.node-version`) and installed
pnpm dependencies. They use Vitest and also run in the Linux devcontainer without Xcode.

## Preferred currency

Choose **Preferred currency** once in Settings. It is saved to your account and
applies across Collection, Search, card details, and purchase totals on both
platforms. Before an explicit selection, the app saves a supported device-region
currency or falls back to USD through the central currency policy.

New purchases default to that currency. Their currency picker remains adjustable
when buying abroad. Editing an existing purchase preserves its original amount
and currency; changing the display preference never rewrites purchase history.

Conversions use the latest collected ECB snapshot, including for older purchases.
Collection, Search, and details use server-computed display prices. The app
only converts amounts locally in purchase forms, using cached rates when offline.
When the server cannot convert a currency pair, it returns the original amount
and currency with an explicit **Conversion unavailable** indicator. Preference
changes clear displayed prices, refetch them, and discard responses from the old
preference; a failed refresh never restores old-currency prices. Import/export retains original amounts and accepts the same
supported currencies as purchase entry.

### Currency diagnostics

In Xcode's console or macOS Console, filter the app process by `TCGCurrency` and
`TCGCurrencyClientImpl` and include informational messages. Debug builds also
record skipped refreshes, cancelled requests, and discarded late responses.
These use the existing KamaalLogger categories, not a separate logging system.

- `currency.preference.applied` confirms the currency applied by the app; its
  source is `cache`, `initialize`, or `save`.
- `currency.rates.applied` identifies `cache` or `network`, the snapshot date,
  and the number of rates. A snapshot date is not necessarily today's date.
- `currency.request.failed` identifies the operation, safe failure reason, and
  HTTP status when known. Cancellation is a debug event instead of a failure.
- `currency.preference.retained` and `currency.rates.retained` explain how the
  app continued after a failed request, including whether cached rates exist.
- `currency.cache.rejected` and `currency.cache.write_failed` identify cache
  problems without including cached content. `currency.session.cleared` confirms
  preference state was reset on sign-out.

For manual testing, save GBP and look for `currency.preference.applied` with
`source=save; currency=GBP`. Relaunch with a rate snapshot cached, then make the
rate endpoint unavailable: expect `source=cache` followed by
`currency.rates.retained` with `cache_status=available`. Without cached rates,
expect `cache_status=missing` for purchase-form conversion. Display-price
conversion is logged on the server as `forex.display.completed`, with the target
currency, snapshot date, and fallback count; fallbacks are warnings.

Request IDs remain a server concern. App logs do not generate, send, or carry
them. Server request and domain logs use the existing `tcg-request-id` convention;
see [server logging](../server/docs/logging.md#currency-workflows).
Logs establish workflow state, while visual formatting still needs UI review.

## Collections and binders

UUID-backed card, purchase, collection, and page identities use `UUID` throughout
the Swift models and state. String conversion happens at HTTP, CSV, and local
preference boundaries. Malformed UUIDs in API responses are rejected.

Collections use the iPhone collection menu or the Mac sidebar. The last open
collection or All cards is remembered locally for each signed-in account.
All cards searches across every collection by card name, set name, or card
number, using server-side filtering and pagination. Unfiled is hidden from
collection navigation but remains the destination for existing entries and cards
without a named collection. Deleting a named collection moves its entries to
Unfiled without removing purchase history.

List or Binder is remembered locally for each collection and signed-in account,
including after restarting the app. Switching is immediate and makes no update request. The choice is not stored
in the database or backups. Page dimensions have independent Columns and Rows
fields: 1 × 4 is one column and four rows. Resizing previews retained
positions and overflow pages before saving. Empty pages and slots are preserved;
switching to List keeps the binder arrangement. When two pages fit at the
current zoom, Binder shows them side by side; narrower windows or larger zoom
show one page. Navigation advances by the visible spread, and the page picker
can focus either page for deletion. Only visible populated pages request card
data.

A slot allocates copies from one owned entry. Four copies can occupy one slot
with quantity three and another with quantity one. Choose an empty slot to place
unassigned copies using the searchable image picker, or add an empty page, while
browsing. Edit collection is reserved for arranging occupied slots, removing
pages, changing dimensions, renaming, and deleting the collection. Reducing ownership trims
later slots and reports the adjustment. Moving
an entry to another collection clears its old placements.

Settings → Collections and layouts exports one, several, or all collections to
one versioned JSON file containing cards, purchases, dimensions, and layouts.
Import previews additions, updates, and moves, then merges the complete file
atomically. Repeated imports match source identities without creating duplicates.
Legacy card CSV import/export remains available; CSV does not contain layouts.
